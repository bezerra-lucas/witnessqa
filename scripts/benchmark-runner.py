#!/usr/bin/env python3
"""Linux-only whole-process-tree benchmark. No consumer data or external API calls."""
from pathlib import Path
import subprocess,os,time,json,resource,statistics,sys
ROOT=None
CPUS=sorted(os.sched_getaffinity(0))[:2]
SELF_HOST=int(Path('/proc/self').resolve().name)
def measure(label,cmd,env,out):
    env={**os.environ,**env}
    for key in ['WITNESS_KEY','OPENROUTER_API_KEY']:env.pop(key,None)
    with open(ROOT/f'{label}.log','w') as log:
        start=time.monotonic();p=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,preexec_fn=lambda:os.sched_setaffinity(0,CPUS));known=set();peak_rss=peak_pss=peak_proc=0;samples=0
        while True:
            allp={}
            for d in Path('/proc').iterdir():
                if not d.name.isdigit():continue
                try:
                    st=(d/'stat').read_text().rsplit(')',1)[1].split();allp[int(d.name)]=(int(st[1]),int(st[21])*os.sysconf('SC_PAGE_SIZE'))
                except (OSError,ValueError):pass
            if not known:
                for pid,(ppid,rss) in allp.items():
                    if ppid!=SELF_HOST:continue
                    try:
                        nspid=next(line for line in Path(f'/proc/{pid}/status').read_text().splitlines() if line.startswith('NSpid:'))
                        if int(nspid.split()[-1])==p.pid:known.add(pid)
                    except (OSError,StopIteration):pass
            changed=True
            while changed:
                fresh={pid for pid,(ppid,rss) in allp.items() if ppid in known}-known;changed=bool(fresh);known|=fresh
            alive=known&allp.keys();rss=sum(allp[pid][1] for pid in alive);pss=0
            for pid in alive:
                try:
                    for line in Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines():
                        if line.startswith('Pss:'):pss+=int(line.split()[1])*1024;break
                except OSError:pass
            peak_rss=max(peak_rss,rss);peak_pss=max(peak_pss,pss);peak_proc=max(peak_proc,len(alive));samples+=1
            waited,status,usage=os.wait4(p.pid,os.WNOHANG)
            if waited:
                p.returncode=os.waitstatus_to_exitcode(status);break
            time.sleep(.1)
    result={'label':label,'wall_s':time.monotonic()-start,'cpu_s':usage.ru_utime+usage.ru_stime,'peak_rss_mib':peak_rss/2**20,'peak_pss_mib':peak_pss/2**20,'peak_processes':peak_proc,'exit':p.returncode,'samples':samples,'affinity':CPUS}
    if out.exists():
        fs=[f for f in out.rglob('*') if f.is_file()];result.update(artifact_mib=sum(f.stat().st_size for f in fs)/2**20,png_count=sum(f.suffix=='.png' for f in fs),html_mib=sum(f.stat().st_size for f in fs if f.name=='REPORT.html')/2**20)
        rs=[json.loads(f.read_text()) for f in out.rglob('result.json')];result['verdicts']={k:sum(r.get('verdict')==k for r in rs) for k in ['pass','fail','blocked','warn']}
    with open(ROOT/'measurements.jsonl','a') as f:f.write(json.dumps(result)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='profile'}),flush=True)
    return result

if __name__ == '__main__':
    import argparse, re
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--browser',help='Use the same installed Chromium for both checkouts')
    parser.add_argument('--repeats',type=int,default=2)
    args=parser.parse_args()
    ROOT=args.out.resolve();ROOT.mkdir(parents=True,exist_ok=False)
    fixture=subprocess.Popen(['node',str(Path(__file__).resolve().parents[1]/'test/fixtures/performance-app.mjs')],env={**os.environ,'PORT':'0'},stdout=subprocess.PIPE,text=True)
    try:
        url=re.search(r'http://127.0.0.1:\d+',fixture.stdout.readline()).group()
        original=ROOT/'scenarios';original.mkdir()
        ready=ROOT/'ready-scenarios';ready.mkdir()
        for index in range(12):
            doc={'name':f'bench-{index:02}', 'viewport':{'width':1440,'height':950},
                 'steps':[{'goto':'/'},{'wait':2000},{'expectText':'Pedidos carregados'},
                          {'expectNoText':'Não foi possível carregar'},{'expectNoText':'Houve um problema'},
                          {'expectNoText':'Something went wrong'}], 'checks':['noBrokenImages']}
            (original/f'{index:02}.json').write_text(json.dumps(doc))
            doc['ready']={'selector':'#ready','text':'Pedidos carregados'}
            doc['steps']=[step for step in doc['steps'] if 'wait' not in step]
            (ready/f'{index:02}.json').write_text(json.dumps(doc))
        records=[]
        for repetition in range(args.repeats):
            specs=[('baseline',args.baseline,original,[]),('defaults',args.candidate,original,[]),
                   ('ready-checkpoints',args.candidate,ready,['--capture','checkpoints'])]
            if repetition%2: specs.reverse()
            for name,checkout,scenarios,extra in specs:
                label=f'{name}-r{repetition+1}';output=ROOT/label
                command=['node',str(checkout.resolve()/'worker/src/worker.mjs'),str(scenarios),
                         '--out',str(output),'--base-url',url,'--jobs','2','--force',*extra]
                env={'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH':args.browser} if args.browser else {}
                result=measure(label,command,env,output)
                if result['exit'] or result['verdicts']['pass']!=12:raise RuntimeError(f'{label} did not pass; inspect its log')
                records.append(result)
        (ROOT/'benchmark.json').write_text(json.dumps(records,indent=2)+'\n')
    finally:
        fixture.terminate();fixture.wait()
