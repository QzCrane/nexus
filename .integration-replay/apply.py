import os,sys,json,lzma,hashlib,subprocess,tempfile
from pathlib import Path
BASE='664d0615f850c568a8840ac312ca7c92cb81ceee'
ARCH='7d4bf273130d73dbf63348affc3a258fcdac4627'
TOTAL='4b14658c107f33778bc5d48505609cafd58a0aec'
EXPECTED='cc81a3cbb01f5ee989a4474ac9d09023e723a291'
RECIPE_SHA='d78977756522b1e73e7bf995f226c6d402c56b70df3ce3b55eaac01b735945d9'
raw=Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(raw).hexdigest()==RECIPE_SHA,'recipe digest mismatch'
p=json.loads(lzma.decompress(raw,memlimit=256*1024*1024))
assert p['base']==BASE and p['tree']==EXPECTED and p['sources']==[BASE,ARCH,TOTAL]
fd,index=tempfile.mkstemp();os.close(fd);os.unlink(index)
env=dict(os.environ,GIT_INDEX_FILE=index)
def git(*args,input=None):return subprocess.check_output(['git',*args],input=input,env=env)
def source_tree(ref):
 result={}
 for record in git('ls-tree','-rz',ref).split(b'\0'):
  if not record:continue
  meta,path=record.split(b'\t',1);mode,kind,sha=meta.split()
  if kind==b'blob':result[path.decode()]=sha.decode()
 return result
sources=[source_tree(x) for x in [BASE,ARCH,TOTAL]]
known={sha for tree in sources for sha in tree.values()}
def validate_path(path):
 assert path and not path.startswith('/') and '..' not in path.split('/') and '\0' not in path
 assert not path.startswith('.git/') and path!='.git'
def put(path,mode,sha):
 validate_path(path);assert mode in ['100644','100755','120000']
 git('update-index','--add','--cacheinfo',f'{mode},{sha},{path}')
def write(path,mode,expected,data):
 sha=git('hash-object','-w','--stdin',input=data).decode().strip();assert sha==expected,('blob mismatch',path,sha,expected)
 put(path,mode,sha)
git('read-tree',BASE)
seen=set()
try:
 for row in p['files']:
  path,mode=row[:2];validate_path(path);assert path not in seen;seen.add(path)
  if mode is None:git('update-index','--force-remove','--',path);continue
  sha=row[2]
  if len(row)==3:
   assert sha in known,('not an audited source blob',path)
   put(path,mode,sha);continue
  source,hunks=row[3:];assert not source or source in known
  lines=git('cat-file','blob',source).decode().splitlines(keepends=True) if source else []
  for a,b,value in reversed(hunks):
   assert 0<=a<=b<=len(lines)
   if isinstance(value,list):
    prior=''.join(lines[a:b]);pieces=[]
    for part in value:
     if isinstance(part,str):pieces.append(part)
     else:
      start,end=part;assert 0<=start<=end<=len(prior);pieces.append(prior[start:end])
    value=''.join(pieces)
   lines[a:b]=[value]
  write(path,mode,sha,''.join(lines).encode())
 for spec in p['computed']:
  path=spec['path'];assert path=='nexus/integration-decisions.json' and path not in seen
  doc=spec['template'];rows=[]
  for item in doc['paths']:
   rows.append({'path':item['path'],'candidateBranches':item['candidateBranches'],'sourceBlobs':dict(zip(['main','architecture','total'],[tree.get(item['path']) for tree in sources])),'decision':item['decision'],'reason':item['reason']})
  doc['paths']=rows
  write(path,spec['mode'],spec['sha'],(json.dumps(doc,ensure_ascii=False,indent=2)+'\n').encode())
 tree=git('write-tree').decode().strip();assert tree==EXPECTED,('tree mismatch',tree)
 print(tree)
finally:
 if Path(index).exists():Path(index).unlink()
