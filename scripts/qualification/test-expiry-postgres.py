import tempfile,subprocess,pathlib,json,importlib.util,os
pg=os.environ.get('QUALIFICATION_TEST_PG_BIN','/opt/homebrew/opt/postgresql@17/bin').rstrip('/')+'/'
module=str(pathlib.Path(__file__).with_name('expire-myeve-approval.py'))
spec=importlib.util.spec_from_file_location('expiry',module);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='r2-expiry-',dir='/tmp') as d:
 def run(args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout
 run([pg+'initdb','-D',d+'/data','-A','trust','--no-locale'])
 run([pg+'pg_ctl','-D',d+'/data','-l',d+'/pg.log','-o',f"-k {d} -p 55479 -h ''",'start'])
 try:
  def sql(s):return run([pg+'psql','-h',d,'-p','55479','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',s]).strip()
  sql('''CREATE TABLE channel_controls(id text,task_id text,binding_id text,reference text,binding_hash text,expires_at timestamptz,account_id text,kind text,consumed_at timestamptz,choice text);
  CREATE TABLE channel_work_links(task_id text,run_id text); CREATE TABLE v2_tasks(id text,status text); CREATE TABLE telegram_bindings(id text,revoked_at timestamptz);
  CREATE TABLE communication_messages(task_id text,direction text,status text,idempotency_key text);
  CREATE TABLE task_approval_decisions(id text,task_id text,owner_id text,binding_hash text,status text,expires_at timestamptz);
  CREATE TABLE owner_qualification_email_pins(pin_id text,attempts int,exhausted_at timestamptz);''')
  cid='ctl_'+'a'*32; aid='approval_'+'b'*64; rid='owner_run_'+'c'*64; bh='d'*64
  def reset():
   sql(f"""TRUNCATE channel_controls,channel_work_links,v2_tasks,telegram_bindings,communication_messages,task_approval_decisions,owner_qualification_email_pins;
   INSERT INTO channel_controls VALUES('{cid}','task','binding','{aid}','{bh}',now()+interval '30 minutes','acct_qualificationrelay','approval',NULL,NULL);
   INSERT INTO channel_work_links VALUES('task','{rid}'); INSERT INTO v2_tasks VALUES('task','WAITING_APPROVAL'); INSERT INTO telegram_bindings VALUES('binding',NULL);
   INSERT INTO communication_messages VALUES('task','OUTBOUND','SENT','channel-pending:{cid}');
   INSERT INTO task_approval_decisions VALUES('{aid}','{rid}','qualification-owner','{bh}','pending',now()+interval '30 minutes');
   INSERT INTO owner_qualification_email_pins VALUES('email-pin-2',0,NULL);""")
  def query(side,s):
   out=sql(s);return json.loads(out) if out else None
  cases={'success':None,'undelivered':"UPDATE communication_messages SET status='RECEIVED'",'consumed':"UPDATE channel_controls SET consumed_at=now()",'relay_expired':"UPDATE channel_controls SET expires_at=now()-interval '1 second'",'wrong_binding':"UPDATE task_approval_decisions SET binding_hash='wrong'",'myeve_expired':"UPDATE task_approval_decisions SET expires_at=now()-interval '1 second'",'pin_used':"UPDATE owner_qualification_email_pins SET attempts=1",'wrong_run':"UPDATE task_approval_decisions SET task_id='other'"}
  for name,mutation in cases.items():
   reset()
   if mutation:sql(mutation)
   try:
    result=m.inject(query,cid,'email-pin-2',lambda e:None)
    assert name=='success',name
    assert sql('SELECT expires_at>now() FROM channel_controls')=='t'
    assert sql('SELECT expires_at<now() FROM task_approval_decisions')=='t'
   except ValueError:
    assert name!='success'
   print(name,'PASS')
 finally:run([pg+'pg_ctl','-D',d+'/data','-m','fast','stop'])
