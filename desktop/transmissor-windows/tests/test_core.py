import asyncio
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from d2win.config import configuration, SafeError, PROFILES
from d2win.media import Latest, pcm_stereo, letterbox_i420, audio_timestamp
from d2win.backend import Backend
from d2win.native_windows import loopback_outputs, Output, require_windows
import httpx
import numpy as np

INVITE = 'https://discord-2-kuau.onrender.com/sala/'+'a'*64

class Configuration(unittest.TestCase):
    def test_actual_sdk_audio_options_api(self):
        from livekit import rtc
        options=rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO,dtx=False)
        options.audio_encoding.max_bitrate=128000
        self.assertEqual(options.audio_encoding.max_bitrate,128000)
    def test_same_linux_profiles_and_no_quality_clamp(self):
        self.assertEqual(PROFILES['1080p60']['fps'],60)
        self.assertEqual(PROFILES['1080p30']['bitrate'],5000000)
        self.assertEqual(configuration(INVITE,' Vivi ', '1080p60').name,'Vivi')
    def test_invalid_invites_and_names(self):
        for invite in [INVITE+'?token=x', INVITE+'#x',INVITE.replace('https:','http:'),
                       INVITE.replace('https://','https://u:p@'), INVITE+'/', 'file:///sala/'+'a'*64]:
            with self.assertRaises(ValueError):configuration(invite,'Vivi','720p30')
        for name in ['a', 'a'*25, 'ab\nx', '😀'*13]:
            with self.assertRaises(ValueError):configuration(INVITE,name,'720p30')
    def test_non_windows_fails_before_capture(self):
        if sys.platform!='win32':
            with self.assertRaises(SafeError):require_windows()

class AudioPrivacy(unittest.TestCase):
    def test_manual_output_identity_ignores_default_marker(self):
        self.assertEqual(Output(5,'USB',2,48000,True).key,Output(5,'USB',2,48000,False).key)
    def test_only_valid_wasapi_loopbacks_even_mic_fake_name(self):
        pa=types.SimpleNamespace(
            get_host_api_info_by_type=lambda _: {'index':2},
            get_default_wasapi_loopback=lambda:{'index':5},
            get_loopback_device_info_generator=lambda:iter([
                {'index':4,'name':'Microphone [Loopback]','isLoopbackDevice':False,'hostApi':2,'maxInputChannels':1,'defaultSampleRate':48000},
                {'index':5,'name':'USB [Loopback]','isLoopbackDevice':True,'hostApi':2,'maxInputChannels':2,'defaultSampleRate':48000},
                {'index':6,'name':'other host','isLoopbackDevice':True,'hostApi':1,'maxInputChannels':2,'defaultSampleRate':48000}]))
        with patch.dict(sys.modules,{'pyaudiowpatch':types.SimpleNamespace(paWASAPI=13)}):
            actual=loopback_outputs(pa)
        self.assertEqual(actual,[Output(5,'USB [Loopback]',2,48000,True)])

class Media(unittest.TestCase):
    def test_missing_wasapi_adc_time_uses_bounded_frame_duration(self):
        self.assertEqual(audio_timestamp({'current_time':1000,'input_buffer_adc_time':0},960,48000,1_000_000),980_000)
        self.assertEqual(audio_timestamp({'current_time':10,'input_buffer_adc_time':9.99},480,48000,1_000_000),990_000)
    def test_latest_bounded(self):
        q=Latest();q.put(1);q.put(2)
        self.assertEqual(q.get(),2);self.assertEqual(q.dropped,1)
        self.assertIsNone(q.get());q.put(3);q.clear();self.assertIsNone(q.get())
    def test_pcm_unity_silence_channel_order_and_duration(self):
        data=np.array([[.1,-.1]]*960,dtype='<f4').tobytes()
        result=np.frombuffer(pcm_stereo(data,2,48000),dtype='<i2').reshape(-1,2)
        self.assertEqual(result.shape,(960,2));self.assertAlmostEqual(result[0,0],3276,delta=1)
        self.assertLess(result[0,1],0)
        self.assertFalse(any(pcm_stereo(bytes(882*4),1,44100)))
        self.assertEqual(len(pcm_stereo(bytes(882*2*4),2,44100)),882*4)
    def test_streaming_resampler_uses_native_sdk_and_preserves_duration(self):
        import subprocess
        code = """
import os
os.environ['RUST_LOG']='off'
import numpy as np
from d2win.media import PcmConverter
from d2win.sdk import dispose_runtime
c=PcmConverter(2,44100)
count=sum(len(c.convert(np.zeros((882,2),dtype='<f4').tobytes())) for _ in range(10))
count+=sum(len(f.data) * f.data.itemsize for f in c.resampler.flush())
assert abs(count//4-9600)<=4,count
c.close()
dispose_runtime()
"""
        import os
        result=subprocess.run([sys.executable,'-c',code],env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parents[1])},capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))
    def test_pcm_nonfinite_does_not_produce_extreme_samples(self):
        result=np.frombuffer(pcm_stereo(np.array([np.nan,np.inf],dtype='<f4').tobytes(),2,48000),dtype='<i2')
        self.assertFalse(result.any())
    def test_letterbox_exact_i420_and_black_bars(self):
        bgra=np.zeros((100,100,4),dtype=np.uint8);bgra[:,:,:3]=255
        data=letterbox_i420(bgra,1280,720)
        self.assertEqual(len(data),1280*720*3//2)
        luma=np.frombuffer(data,dtype=np.uint8)[:1280*720].reshape(720,1280)
        self.assertLess(int(luma[360,0]),int(luma[360,640]))

class Api(unittest.IsolatedAsyncioTestCase):
    async def test_existing_contract_auth_redirects_and_no_secret(self):
        requests=[]
        def respond(request):
            requests.append(request)
            if request.url.path.endswith('token'):
                return httpx.Response(200,json={'token':'ephemeral','serverUrl':'wss://example.test'})
            return httpx.Response(200,json={'reservationHeld':False})
        client=httpx.AsyncClient(transport=httpx.MockTransport(respond),follow_redirects=False)
        b=Backend(configuration(INVITE,'Vivi','1080p60'),client)
        self.assertEqual(await b.login(),('wss://example.test','ephemeral'))
        await b.share('acquire');self.assertTrue(await b.release())
        self.assertNotIn('Authorization',requests[0].headers)
        self.assertEqual(requests[1].headers['Authorization'],'Bearer ephemeral')
        await b.close();self.assertIsNone(b.token)
    async def test_error_does_not_expose_remote_text(self):
        client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _:httpx.Response(409,json={'error':'sensitive-token'})))
        b=Backend(configuration(INVITE,'Vivi','720p30'),client);b.token='ephemeral'
        with self.assertRaises(SafeError) as error:await b.share('acquire')
        self.assertIn('Outra pessoa',str(error.exception));self.assertNotIn('sensitive',str(error.exception))
        await b.close()
    async def test_redirect_or_insecure_livekit_rejected(self):
        for response in [httpx.Response(302,headers={'Location':'https://attacker.invalid'}),
                         httpx.Response(200,json={'token':'ephemeral','serverUrl':'ws://insecure.test'})]:
            client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _:response))
            b=Backend(configuration(INVITE,'Vivi','720p30'),client)
            with self.assertRaises(SafeError):await b.login()
            await b.close()
