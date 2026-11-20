export interface SqlBenchmarkCase {
  id: string; title: string; category: string; schema: string; seed: string; query: string;
  reference: number; tolerance: number; rationale: string; expectedFindings: string[];
  relevantCriteria: string[];
}

export const scenario = {
  title: 'Retail repeat-customer analysis',
  description: 'Create SQLite customers and orders tables with a one-to-many relationship, primary and foreign keys, valid required fields, sample data, and a query returning each customer with at least two distinct orders and total spend in integer cents. Results must have one row per customer.',
  required: ['customers and orders', 'primary keys', 'orders.customer_id foreign key', 'required fields and nonnegative amount', 'sample data', 'repeat query with count and sum'],
  weights: { 'Problem understanding': 15, 'Technical correctness': 25, 'Reasoning and approach': 20, 'Practical implementation': 25, 'Measurement and validation': 15 }
};

const schema = `CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));`;
const seed = `INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);`;
const query = `SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;`;
type Def = [string,string,string,string,string,number,string,string[]];
const defs: Def[] = [
 ['sql-01','Excellent implementation','excellent',schema,query,100,'Complete design; verified schema, constraints and repeat-customer totals.',['complete','correct output']],
 ['sql-02','Strong; no nonnegative amount check','strong omission',schema.replace(' CHECK(total_cents>=0)',''),query,91,'All major requirements pass; negative order totals remain possible.',['missing nonnegative check']],
 ['sql-03','Valid text natural-key alternative','valid alternative',`CREATE TABLE customers(customer_code TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id TEXT PRIMARY KEY,customer_code TEXT NOT NULL REFERENCES customers(customer_code),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));`,`SELECT c.customer_code customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_code=c.customer_code GROUP BY c.customer_code,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_code;`,100,'Text keys are a valid alternative; evaluation must not require integer IDs.',['valid alternative']],
 ['sql-04','Counts distinct dates, not orders','partial',schema,query.replaceAll('COUNT(DISTINCT o.order_id)','COUNT(DISTINCT o.order_date)'),55,'Same-day separate orders collapse; schema itself is sound.',['incorrect order identity count']],
 ['sql-05','Tables without primary keys','design error',`CREATE TABLE customers(customer_id INTEGER,name TEXT,email TEXT); CREATE TABLE orders(order_id INTEGER,customer_id INTEGER,order_date TEXT,total_cents INTEGER);`,query,32,'Schema lacks keys and integrity; it does not load into the intended validated dataset.',['no primary keys','no foreign key']],
 ['sql-06','Missing foreign key','missing FK',schema.replace(' REFERENCES customers(customer_id)',''),query,68,'Query works, but orphan orders are accepted.',['orphan rows not prevented']],
 ['sql-07','Foreign key references nonexistent table','invalid FK',schema.replace('REFERENCES customers(customer_id)','REFERENCES customer(customer_id)'),query,10,'Invalid target causes schema/use failure.',['invalid foreign key target']],
 ['sql-08','Unique child foreign key breaks one-to-many','wrong cardinality',schema.replace('customer_id INTEGER NOT NULL REFERENCES','customer_id INTEGER NOT NULL UNIQUE REFERENCES'),query,56,'Uniqueness prevents multiple orders per customer.',['one-to-one constraint']],
 ['sql-09','Inappropriate declared types','data types',`CREATE TABLE customers(customer_id TEXT PRIMARY KEY,name INTEGER NOT NULL,email BLOB NOT NULL UNIQUE); CREATE TABLE orders(order_id TEXT PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date INTEGER NOT NULL,total_cents TEXT NOT NULL);`,query,45,'Declarations are inconsistent and amount safety is unclear; SQLite affinity can mask defects.',['inconsistent types']],
 ['sql-10','Required fields nullable','missing NOT NULL',schema.replaceAll(' NOT NULL',''),query,82,'Core structure/query work but required columns accept NULL.',['nullable required fields']],
 ['sql-11','Syntax error in query','syntax error',schema,`SELECT c.name COUNT(o.order_id) FROM customers c JOIN orders o ON`,15,'Schema is usable, but required query cannot execute.',['query syntax error']],
 ['sql-12','Requires three orders instead of two','wrong threshold',schema,query.replace('>=2','>=3'),70,'Executes but omits Mina, who has exactly two orders.',['wrong qualifying set']],
 ['sql-13','Self-join multiplies order rows','fan-out',schema,`SELECT c.customer_id customer_key,c.name customer_name,COUNT(o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id JOIN orders later ON later.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(o.order_id)>=2;`,48,'Join fan-out inflates counts and spending.',['inflated aggregation']],
 ['sql-14','Wrong grouping grain and threshold','grouping error',schema,`SELECT c.customer_id customer_key,c.name customer_name,o.order_date,COUNT(o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,o.order_date HAVING COUNT(o.order_id)>=1;`,42,'Groups by date and includes one-time purchasers, violating output grain.',['wrong grain','wrong repeat qualification']],
 ['sql-15','Average mislabeled as total spend','aggregation error',schema,query.replace('SUM(o.total_cents)','AVG(o.total_cents)'),62,'Correct customer set but incorrect requested measure.',['average substituted for sum']],
 ['sql-16','Unsafe string-interpolated query','injection risk',schema,query,75,'Schema/query artifacts work, but application snippet concatenates untrusted input.',['unsafe interpolation; do not execute candidate app code']],
 ['sql-17','Empty submission','empty','','',0,'No evidence or deliverables.',['empty']],
 ['sql-18','Irrelevant response','irrelevant','-- teamwork, leadership, customer value','SELECT 1;',0,'No schema, relationship, sample data, or repeat analysis.',['irrelevant']],
 ['sql-19','Keyword-heavy broken schema/query','keyword-heavy wrong',`-- customers orders PRIMARY KEY FOREIGN KEY one-to-many NOT NULL repeat customers SUM JOIN GROUP BY\nCREATE TABLE customers(id INTEGER,name TEXT); CREATE TABLE orders(id INTEGER,customer_id INTEGER,amount TEXT);`,`SELECT c.name,SUM(o.amount) total_spend_cents FROM customers c JOIN orders o ON o.id=c.id GROUP BY o.amount;`,8,'Comments have terminology but no keys/FK; join and grouping are wrong.',['comments are not evidence','wrong join and grouping']],
 ['sql-20','Correlated EXISTS alternative','valid alternative',schema,`SELECT c.customer_id customer_key,c.name customer_name,(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.customer_id) order_count,(SELECT SUM(o.total_cents) FROM orders o WHERE o.customer_id=c.customer_id) total_spend_cents FROM customers c WHERE EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.customer_id GROUP BY o.customer_id HAVING COUNT(*)>=2) ORDER BY c.customer_id;`,100,'Equivalent correlated subqueries produce correct results without reference-query matching.',['valid alternative']]
];

const alternativeSeed = `INSERT INTO customers VALUES('M','Mina','m@test'),('R','Ravi','r@test'),('L','Li','l@test'),('N','Nora','n@test'); INSERT INTO orders VALUES('a','M','2026-01-02',10000),('b','M','2026-01-02',14550),('c','R','2026-02-04',900),('d','L','2026-01-10',1000),('e','L','2026-02-10',2000),('f','L','2026-03-10',2500);`;
export const sqlBenchmarkCases = defs.map(([id,title,category,candidateSchema,candidateQuery,reference,rationale,expectedFindings]) => ({
  id,title,category,schema:candidateSchema,query:candidateQuery,seed:id==='sql-03'?alternativeSeed:seed,
  reference,tolerance:category==='empty'?0:5,rationale,expectedFindings,
  relevantCriteria: ['Problem understanding','Technical correctness','Reasoning and approach','Practical implementation','Measurement and validation'],
  appCode: category==='injection risk' ? `const sql = "SELECT * FROM customers WHERE email = '" + userEmail + "'";` : undefined
}));
