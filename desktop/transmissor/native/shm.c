#define _GNU_SOURCE
#include <node_api.h>
#include <stdint.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

// Allowlisted 720p/1080p I420 rings. No paths, file creation or arbitrary sizes.
#define FRAME_BYTES (1920u * 1080u * 3u / 2u)
#define SLOTS 3
static void unmap_frame(napi_env env, void *data, void *hint) {
  (void)env;
  munmap(data, (size_t)(uintptr_t)hint);
}
static napi_value map_frame(napi_env env, napi_callback_info info) {
  size_t argc=3;
  napi_value args[3], result;
  uint32_t bytes=FRAME_BYTES;
  int32_t fd=-1, slot=-1;
  int seals;
  struct stat st;
  long page=sysconf(_SC_PAGESIZE);
  size_t stride;
  if(napi_get_cb_info(env,info,&argc,args,NULL,NULL)!=napi_ok || (argc!=2 && argc!=3) ||
     (argc==3 && napi_get_value_uint32(env,args[2],&bytes)!=napi_ok) ||
     (bytes!=FRAME_BYTES && bytes!=1280u*720u*3u/2u) ||
     ((stride=(bytes+(size_t)page-1)/(size_t)page*(size_t)page)==0) ||
     napi_get_value_int32(env,args[0],&fd)!=napi_ok ||
     napi_get_value_int32(env,args[1],&slot)!=napi_ok || fd<3 || slot<0 || slot>=SLOTS ||
     (seals=fcntl(fd,F_GET_SEALS))<0 || (seals&(F_SEAL_GROW|F_SEAL_SHRINK))!=(F_SEAL_GROW|F_SEAL_SHRINK) ||
     fstat(fd,&st)!=0 || !S_ISREG(st.st_mode) || st.st_size!=(off_t)(stride*SLOTS)) {
    napi_throw_range_error(env,NULL,"Invalid frame ring descriptor or slot"); return NULL;
  }
  void *data=mmap(NULL,bytes,PROT_READ|PROT_WRITE,MAP_SHARED,fd,(off_t)(slot*stride));
  if(data==MAP_FAILED){napi_throw_error(env,NULL,"Cannot map frame ring");return NULL;}
  if(napi_create_external_arraybuffer(env,data,bytes,unmap_frame,(void *)(uintptr_t)bytes,&result)!=napi_ok){
    munmap(data,bytes); napi_throw_error(env,NULL,"Cannot expose frame ring");return NULL;
  }
  return result;
}
static napi_value init(napi_env env,napi_value exports) {
  napi_value fn;
  if(napi_create_function(env,"mapFrame",NAPI_AUTO_LENGTH,map_frame,NULL,&fn)!=napi_ok)return NULL;
  if(napi_set_named_property(env,exports,"mapFrame",fn)!=napi_ok)return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
