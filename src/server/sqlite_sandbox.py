"""Isolated SQLite verifier for authored benchmark SQL. Never receives host DB paths."""
import json
import sqlite3
import sys

DENIED = {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_PRAGMA, sqlite3.SQLITE_CREATE_VTABLE, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_CREATE_TEMP_TRIGGER}
READ_ONLY_DENIED = DENIED | {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_CREATE_TEMP_INDEX, sqlite3.SQLITE_CREATE_TEMP_TABLE, sqlite3.SQLITE_CREATE_TEMP_TRIGGER, sqlite3.SQLITE_CREATE_TEMP_VIEW, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_CREATE_VIEW, sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_DROP_TEMP_INDEX, sqlite3.SQLITE_DROP_TEMP_TABLE, sqlite3.SQLITE_DROP_TEMP_TRIGGER, sqlite3.SQLITE_DROP_TEMP_VIEW, sqlite3.SQLITE_DROP_TRIGGER, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_SAVEPOINT}

def run_case(case):
    out = {"schemaOk": False, "seedOk": False, "queryOk": False, "findings": [], "rows": [], "schema": {}, "probes": {}}
    if not case.get("schema", "").strip():
        out["findings"].append("empty schema")
        return out
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
    db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 100000)
    db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 100)
    db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
    db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 500)
    db.setlimit(sqlite3.SQLITE_LIMIT_TRIGGER_DEPTH, 10)
    db.set_progress_handler(lambda: 1, 250000)
    def authorizer(action, arg1, arg2, db_name, trigger):
        # The verifier already enables FK enforcement. Many valid candidates repeat
        # this harmless setup pragma in their DDL block; do not mistake it for a
        # prohibited evaluator action. Disabling FK checks remains forbidden.
        if action == sqlite3.SQLITE_PRAGMA and (arg1 or "").lower() == "foreign_keys" and (arg2 or "").lower() in {"on", "1", "true"}:
            return sqlite3.SQLITE_OK
        if action in DENIED:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").lower() in {"load_extension", "writefile", "readfile"}:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    def read_only_authorizer(action, arg1, arg2, db_name, trigger):
        if action in READ_ONLY_DENIED:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").lower() in {"load_extension", "writefile", "readfile"}:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    db.set_authorizer(authorizer)
    try:
        db.executescript(case.get("schema", ""))
        out["schemaOk"] = True
    except Exception as exc:
        out["findings"].append("schema error: " + str(exc)[:160])
    if out["schemaOk"]:
        try:
            db.executescript(case.get("seed", ""))
            out["seedOk"] = True
        except Exception as exc:
            out["findings"].append("sample data error: " + str(exc)[:160])
        # Inspect trusted metadata only; candidate PRAGMA statements remain denied.
        db.set_authorizer(None)
        for table in ("customers", "orders"):
            try:
                cols = db.execute('SELECT name,type,"notnull",pk FROM pragma_table_info(?)', (table,)).fetchall()
                out["schema"][table] = [{"name":r[0],"type":r[1].upper(),"notNull":bool(r[2]),"pk":bool(r[3])} for r in cols]
                out["schema"][table+"FK"] = db.execute('SELECT "table","from","to" FROM pragma_foreign_key_list(?)', (table,)).fetchall()
                out["schema"][table+"Indexes"] = db.execute('SELECT sql FROM sqlite_master WHERE type="index" AND tbl_name=?', (table,)).fetchall()
            except Exception:
                out["schema"][table] = []
        # Probes are savepoint-isolated and rolled back; they assess constraints without retaining test rows.
        def rejected(sql, params=()):
            try:
                db.execute("SAVEPOINT verifier_probe")
                db.execute(sql, params)
                db.execute("ROLLBACK TO verifier_probe")
                db.execute("RELEASE verifier_probe")
                return False
            except Exception:
                try:
                    db.execute("ROLLBACK TO verifier_probe")
                    db.execute("RELEASE verifier_probe")
                except Exception:
                    pass
                return True
        def insert_probe(table, overrides=None):
            info=db.execute('SELECT name,type,"notnull",pk FROM pragma_table_info(?)',(table,)).fetchall()
            if not info:
                return False
            row=[]
            for name, declared, required, pk in info:
                key=name.lower()
                if overrides and key in overrides:
                    value=overrides[key]
                elif pk:
                    value=999999 if "INT" in declared.upper() else "probe-key"
                elif key in {"name","customer_name"}:
                    value="Probe"
                elif key=="email":
                    value="probe-unique@test"
                elif key in {"order_date","created_at","date"}:
                    value="2026-01-01"
                elif key in {"total_cents","amount","total"}:
                    value=1
                elif key in {"customer_id","customer_code"} and table=="orders":
                    value=1
                elif required:
                    value=1 if "INT" in declared.upper() else "probe"
                else:
                    value=None
                row.append(value)
            cols=','.join('"'+str(r[0]).replace('"','')+'"' for r in info)
            marks=','.join('?' for _ in row)
            try:
                db.execute("SAVEPOINT verifier_probe")
                db.execute(f'INSERT INTO "{table}" ({cols}) VALUES ({marks})',row)
                db.execute("ROLLBACK TO verifier_probe")
                db.execute("RELEASE verifier_probe")
                return False
            except sqlite3.IntegrityError:
                db.execute("ROLLBACK TO verifier_probe")
                db.execute("RELEASE verifier_probe")
                return True
            except Exception:
                try:
                    db.execute("ROLLBACK TO verifier_probe")
                    db.execute("RELEASE verifier_probe")
                except Exception:
                    pass
                return False
        customer_info=db.execute('SELECT name,type,"notnull",pk FROM pragma_table_info(?)',("customers",)).fetchall()
        customer_pk=next((r[0] for r in customer_info if r[3]),None)
        existing_pk=None
        if customer_pk:
            try: existing_pk=db.execute(f'SELECT "{customer_pk}" FROM customers LIMIT 1').fetchone()[0]
            except Exception: pass
        email_value=None
        if any(r[0].lower()=="email" for r in customer_info):
            try: email_value=db.execute('SELECT email FROM customers LIMIT 1').fetchone()[0]
            except Exception: pass
        fk_rows=out["schema"].get("ordersFK",[])
        fk_column=fk_rows[0][1] if fk_rows else None
        negative_column=next((r[0] for r in db.execute('SELECT name FROM pragma_table_info(?)',("orders",)).fetchall() if r[0].lower() in ("total_cents","amount_cents","total_amount_cents","total_spend_cents","amount","total")),None)
        date_column=next((r[0] for r in db.execute('SELECT name FROM pragma_table_info(?)',("orders",)).fetchall() if r[0].lower() in ("order_date","created_at","date")),None)
        out["probes"] = {
            "duplicateCustomerKeyRejected": bool(customer_pk and existing_pk is not None and insert_probe("customers",{customer_pk.lower():existing_pk})),
            "orphanOrderRejected": bool(fk_column and insert_probe("orders",{fk_column.lower():"__missing_customer__"})),
            "negativeAmountRejected": bool(negative_column and insert_probe("orders",{negative_column.lower():-1})),
            "nullOrderDateRejected": bool(date_column and insert_probe("orders",{date_column.lower():None})),
            "duplicateEmailRejected": bool(email_value is not None and insert_probe("customers",{"email":email_value}))
        }
        try:
            cust_pk_name=next((r[0] for r in customer_info if r[3]),None)
            order_info=db.execute('SELECT name,type,"notnull",pk FROM pragma_table_info(?)',("orders",)).fetchall()
            fk_meta=out["schema"].get("ordersFK",[])
            fk_name=fk_meta[0][1] if fk_meta else next((r[0] for r in order_info if r[0].lower() in ("customer_id","customer_code")),None)
            order_id_name=next((r[0] for r in order_info if r[3]),None)
            quote=lambda value:'"'+str(value).replace('"','""')+'"'
            customer_count=db.execute('SELECT COUNT(*) FROM customers').fetchone()[0]
            order_count=db.execute('SELECT COUNT(*) FROM orders').fetchone()[0]
            repeat_count=db.execute(f'SELECT COUNT(*) FROM (SELECT {quote(fk_name)} FROM orders GROUP BY {quote(fk_name)} HAVING COUNT(DISTINCT {quote(order_id_name)})>=2)').fetchone()[0] if fk_name and order_id_name else 0
            zero_count=db.execute(f'SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON o.{quote(fk_name)}=c.{quote(cust_pk_name)} WHERE o.{quote(fk_name)} IS NULL').fetchone()[0] if fk_name and cust_pk_name else 0
            out["sampleShape"]={"customers":customer_count,"orders":order_count,"repeatCustomers":repeat_count,"zeroOrderCustomers":zero_count}
        except Exception:
            out["sampleShape"]={"customers":0,"orders":0,"repeatCustomers":0,"zeroOrderCustomers":0}
        db.set_authorizer(read_only_authorizer)
        try:
            cur = db.execute(case.get("query", ""))
            out["columns"] = [d[0].lower() for d in (cur.description or [])]
            out["rows"] = [list(r) for r in cur.fetchall()]
            out["queryOk"] = True
        except Exception as exc:
            out["findings"].append("query error: " + str(exc)[:160])
        db.set_authorizer(None)
        out.update(run_controlled(case.get("schema", ""), case.get("query", "")))
    db.close()
    return out

def run_submission(case):
    """Run only candidate-authored SQL; do not load or return hidden verifier fixtures."""
    out={"schemaOk":False,"seedOk":False,"queryOk":False,"columns":[],"rows":[],"rowCount":0,"truncated":False,"errors":{}}
    schema=case.get("schema","")
    seed=case.get("seed","")
    query=case.get("query","")
    if not any(part.strip() for part in (schema,seed,query)):
        out["errors"]["schema"]="Enter SQL in the schema, sample data, or query editor before running."
        return out
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED,0)
    db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,50000)
    db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN,30)
    db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,50000)
    db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,500)
    db.setlimit(sqlite3.SQLITE_LIMIT_TRIGGER_DEPTH,0)
    db.set_progress_handler(lambda:1,100000)
    def authorizer(action,arg1,arg2,db_name,trigger):
        if action==sqlite3.SQLITE_PRAGMA and (arg1 or "").lower()=="foreign_keys" and (arg2 or "").lower() in {"on","1","true"}:
            return sqlite3.SQLITE_OK
        if action in DENIED or action in {sqlite3.SQLITE_CREATE_TRIGGER,sqlite3.SQLITE_CREATE_TEMP_TRIGGER}:
            return sqlite3.SQLITE_DENY
        if action==sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").lower() in {"load_extension","writefile","readfile"}:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    try:
        db.set_authorizer(authorizer)
        if schema.strip():
            try:
                db.executescript(schema)
                out["schemaOk"]=True
            except Exception as exc:
                out["errors"]["schema"]="Schema SQL: "+str(exc)[:180]
                return out
        else:
            out["schemaOk"]=True
        if seed.strip():
            try:
                db.executescript(seed)
                out["seedOk"]=True
            except Exception as exc:
                out["errors"]["seed"]="Sample data SQL: "+str(exc)[:180]
                return out
        else:
            out["seedOk"]=True
        if query.strip():
            db.set_authorizer(readonly_authorizer)
            try:
                cursor=db.execute(query)
                out["columns"]=[description[0] for description in (cursor.description or [])]
                if len(out["columns"])>30:
                    raise ValueError("Query output exceeds the 30-column limit.")
                rows=cursor.fetchmany(201)
                out["truncated"]=len(rows)>200
                rows=rows[:200]
                normalized=[]
                output_size=0
                for row in rows:
                    values=[]
                    for cell in row:
                        if isinstance(cell,bytes): cell=cell.decode("utf-8","replace")
                        if isinstance(cell,str) and len(cell)>500: cell=cell[:500]+"…"
                        values.append(cell)
                    output_size+=len(json.dumps(values,ensure_ascii=False,default=str))
                    if output_size>50000:
                        out["truncated"]=True
                        break
                    normalized.append(values)
                out["rows"]=normalized
                out["rowCount"]=len(normalized)
                out["queryOk"]=True
            except Exception as exc:
                out["errors"]["query"]="Query SQL: "+str(exc)[:180]
        else:
            out["errors"]["query"]="Write a SELECT query to inspect your data."
    finally:
        db.close()
    return out

def run_controlled(schema_sql, query_sql):
    """Execute the submitted query against a verifier-owned fixed dataset in a fresh DB."""
    result={"controlledDataOk":False,"controlledQueryOk":False,"controlledRows":[],"controlledColumns":[],"controlledFindings":[]}
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED,0)
    db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000)
    db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN,100)
    db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,1_000_000)
    db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,500)
    db.set_progress_handler(lambda:1,250000)
    def auth(action,arg1,arg2,db_name,trigger):
        if action==sqlite3.SQLITE_PRAGMA and (arg1 or "").lower()=="foreign_keys" and (arg2 or "").lower() in {"on","1","true"}:
            return sqlite3.SQLITE_OK
        if action in DENIED or action in {sqlite3.SQLITE_CREATE_TRIGGER,sqlite3.SQLITE_CREATE_TEMP_TRIGGER}:
            return sqlite3.SQLITE_DENY
        if action==sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").lower() in {"load_extension","writefile","readfile"}:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    db.set_authorizer(auth)
    try:
        db.executescript(schema_sql)
        db.set_authorizer(None)
        customers=db.execute('SELECT name,type,"notnull",pk FROM pragma_table_info(?)',("customers",)).fetchall()
        orders=db.execute('SELECT name,type,"notnull",pk FROM pragma_table_info(?)',("orders",)).fetchall()
        foreign=db.execute('SELECT "from","to" FROM pragma_foreign_key_list(?) WHERE "table"=?',("orders","customers")).fetchall()
        if not customers or not orders:
            raise ValueError("required tables missing from controlled fixture")
        cust_pk=next((r[0] for r in customers if r[3]),None)
        order_pk=next((r[0] for r in orders if r[3]),None)
        cust_ids=[1,2,3,4] if cust_pk and "INT" in next((r[1].upper() for r in customers if r[0]==cust_pk),"") else ["M","R","L","N"]
        def values(meta, table, index, ident, customer_id=None, amount=None, date=None, foreign_key_name=None):
            items=[]
            for name,declared,required,pk in meta:
                key=name.lower(); val=None
                if pk: val=ident
                elif key in {"name","customer_name","full_name","customer"}: val=["Mina","Ravi","Li","Nora"][index] if table=="customers" else "Fixture order"
                elif key=="email": val=["mina@fixture.test","ravi@fixture.test","li@fixture.test","nora@fixture.test"][index] if table=="customers" else "fixture@test"
                elif key in {"customer_id","customer_code"} or (foreign_key_name and key==foreign_key_name.lower()): val=customer_id if customer_id is not None else (cust_ids[index] if table=="orders" else ident)
                elif key in {"order_date","created_at","date"}: val=date or "2026-01-02"
                elif key in {"total_cents","amount_cents","total_amount_cents","total_spend_cents","amount","total"}: val=amount if amount is not None else 1
                elif required: val=0 if "INT" in declared.upper() else "fixture"
                items.append(val)
            return items
        def insert_rows(table,meta,rows):
            columns=','.join('"'+r[0].replace('"','')+'"' for r in meta)
            marks=','.join('?' for _ in meta)
            db.executemany(f'INSERT INTO "{table}" ({columns}) VALUES ({marks})',rows)
        insert_rows("customers",customers,[values(customers,"customers",i,cust_ids[i]) for i in range(4)])
        fk_col=foreign[0][0] if foreign else next((r[0] for r in orders if r[0].lower() in {"customer_id","customer_code"}),None)
        customer_by_index={"Mina":cust_ids[0],"Ravi":cust_ids[1],"Li":cust_ids[2]}
        order_data=[("Mina",10000,"2026-01-02"),("Mina",14550,"2026-01-02"),("Ravi",900,"2026-02-04"),("Li",1000,"2026-01-10"),("Li",2000,"2026-02-10"),("Li",2500,"2026-03-10")]
        orders_rows=[]
        for index,(name,amount,date) in enumerate(order_data):
            customer_index={"Mina":0,"Ravi":1,"Li":2}[name]
            vals=values(orders,"orders",customer_index,(101+index if not order_pk or "INT" in next((r[1].upper() for r in orders if r[0]==order_pk),"") else f"o{index+1}"),customer_by_index[name],amount,date,fk_col)
            orders_rows.append(vals)
        insert_rows("orders",orders,orders_rows)
        result["controlledDataOk"]=True
        db.set_authorizer(readonly_authorizer)
        cur=db.execute(query_sql)
        result["controlledColumns"]=[d[0].lower() for d in (cur.description or [])]
        result["controlledRows"]=[list(r) for r in cur.fetchall()]
        result["controlledQueryOk"]=True
    except Exception as exc:
        result["controlledFindings"].append("controlled test: "+str(exc)[:160])
    finally:
        db.close()
    return result

def readonly_authorizer(action,arg1,arg2,db_name,trigger):
    if action in READ_ONLY_DENIED:
        return sqlite3.SQLITE_DENY
    if action==sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").lower() in {"load_extension","writefile","readfile"}:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK

try:
    payload = json.load(sys.stdin)
    if isinstance(payload,dict) and payload.get("mode")=="run":
        print(json.dumps(run_submission(payload),ensure_ascii=False,default=str))
    else:
        print(json.dumps([run_case(c) for c in payload] if isinstance(payload,list) else run_case(payload)))
except Exception as exc:
    print(json.dumps({"runnerError": str(exc)[:240]}))
    sys.exit(1)
