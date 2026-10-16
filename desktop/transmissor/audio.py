"""Monitor inspection and explicit, headroom-limited capture gain. Never moves/mutes playback."""
import audioop
import json
import math
import subprocess


def apply_gain(data, gain_db):
    if gain_db not in (0, 6, 12):
        raise ValueError('Ganho inválido')
    peak = audioop.max(data, 2)
    gain = 10**(gain_db/20)
    # One linear gain per block, bounded by 1 dBFS headroom. No hard clipping or AGC.
    # Unity preserves the source exactly. Raising gain is an explicit user choice.
    effective = min(gain, 32768*10**(-1/20)/peak) if gain_db and peak else gain
    result = audioop.mul(data, 2, effective) if gain_db else data
    return result, effective < gain


def pulse_output(*args):
    # Bound requests: a disconnected audio server must not indefinitely freeze GTK.
    import os
    return subprocess.check_output(['pactl', *args], timeout=3,
                                   env={**os.environ, 'LC_ALL': 'C.UTF-8'})


def _reference_matches(reference, item):
    if reference is None or reference in ('', -1, 4294967295, '-1', '4294967295'):
        return False
    return any(value is not None and str(reference) == str(value)
               for value in (item.get('name'), item.get('index')))


def output_monitors(sources, sinks, default_sink=None):
    """Resolve actual output monitors, never infer permission from a name suffix."""
    result = []
    for source in sources:
        name = source.get('name')
        if not isinstance(name, str) or not name:
            continue
        reference = source.get('monitor_of_sink', source.get('monitor_source'))
        sink = next((item for item in sinks if _reference_matches(reference, item)), None)
        if sink is None:
            continue
        # If supplied, the reverse link must also identify this source.
        reverse = sink.get('monitor_source')
        if reverse is not None and not _reference_matches(reverse, source):
            continue
        def friendly(item):
            props = item.get('properties') or {}
            candidates = [item.get('description'), props.get('device.description'),
                          props.get('node.nick'), props.get('alsa.card_name')]
            return next((value.strip() for value in candidates if isinstance(value, str)
                         and value.strip() and value.strip().lower() not in ('(null)', 'null', 'none')), None)
        label = friendly(sink) or friendly(source) or sink['name']
        is_default = sink['name'] == default_sink
        result.append({**source, 'description': label + ' — áudio da saída' + (' (padrão)' if is_default else ''),
                       'sinkName': sink['name'], 'isDefault': is_default})
    # Include suspended/idle monitors too; RUNNING is not a permission requirement.
    counts = {}
    for item in result:
        counts[item['description']] = counts.get(item['description'], 0) + 1
    for item in result:
        if counts[item['description']] > 1:
            item['description'] += ' [' + item['sinkName'] + ']'
    return sorted(result, key=lambda item: (not item['isDefault'], item['description'], item['name']))


def monitors():
    sources = json.loads(pulse_output('-f', 'json', 'list', 'sources'))
    sinks = json.loads(pulse_output('-f', 'json', 'list', 'sinks'))
    try:
        default = pulse_output('get-default-sink').decode('utf-8').strip()
    except (subprocess.SubprocessError, OSError):
        default = None
    return output_monitors(sources, sinks, default)


def monitor_state(name):
    def pactl(kind):
        return json.loads(pulse_output('-f', 'json', 'list', kind))
    sources, sinks = pactl('sources'), pactl('sinks')
    source = next((s for s in output_monitors(sources, sinks) if s['name'] == name), None)
    if source is None:
        raise ValueError('Monitor de saída indisponível')
    sink = next(s for s in sinks if s['name'] == source['sinkName'])
    def levels(item):
        return dict(mute=item.get('mute'), volumePercent=[v['value_percent'] for v in item.get('volume', {}).values()],
                    state=item.get('state'))
    return dict(source=levels(source), playback=levels(sink),
                monitorConfirmed=True, changesToPlayback=False)
