# ProofPilot Evaluator Benchmark & Technical QA Report

Generated: 2026-11-08T10:40:35.031Z

## Executive summary

The current in-app evaluator remains deterministic regex evidence matching. It has no SQL parser, compiler, database execution, or runtime verification. This work adds an isolated SQLite benchmark and a fact-based SQL benchmark scorer, but does not wire SQL evaluation into the assessment UI. The UI and visual components were not changed.

**SQL cases executed:** 20/20. **Mean absolute difference from provisional references:** 9.20 points. **Within ±5:** 10/20 (50.0%). **Within ±10:** 13/20 (65.0%). The 90% ±5 benchmark target was **not reached**.

Reference scores are manually authored and provisional, not independently reviewed by an expert. The agreement figures are benchmark-specific and are not real-world accuracy claims.

**Serious score deviations (>10 points from the provisional reference):** 7 (6 over-scored; 1 under-scored). **Invalid submissions scoring ≥70:** 3.

## Existing evaluator findings

- `src/lib/evaluation.ts` normalizes answer text and applies regular-expression evidence rules from challenge rubrics. Each match earns credit; listed misconception patterns subtract points. Problem understanding is calculated from task-anchor matches; remaining dimensions are calculated from matched evidence fractions. The final score is the weighted mean, rounded to an integer.
- The existing evaluation does not compile or execute candidate code, parse SQL, inspect schema metadata, verify query output, or test referential integrity. Technical correctness is inferred from matching phrases.
- Alternative approaches receive credit only when a rubric expression happens to recognize their wording. Equivalent solutions outside the pattern set can be missed. Conversely, a matched phrase can be rewarded even if the complete reasoning is contradictory.
- Feedback is composed from matched rubric rationales, missing rules and listed misconception explanations. It does not quote or locate the candidate’s actual mistake.
- Rubrics are challenge-specific for the existing twelve challenge IDs, but contain hand-authored evidence patterns rather than executable technical tests.
- Report generation stores the answer and the already-computed evaluation in local assessment records; no evaluator re-run or code verification happens when rendering the report.

The requested dimensions are now weighted Problem understanding 15%, Technical correctness 25%, Reasoning and approach 20%, Practical implementation 25%, Measurement and validation 15%. Existing content-based deterministic evaluator still uses rubric rule matching.

## Benchmark scenario

**Retail repeat-customer analysis.** Build SQLite customers/orders tables, enforce a one-to-many foreign-key relationship and valid required records, insert a controlled six-order/four-customer dataset, and return one row for each customer with at least two distinct orders and the correct order count and total spend in cents. Two Mina orders share a date so counting distinct dates cannot pass.

Required: customers and orders; primary keys; orders.customer_id foreign key; required fields and nonnegative amount; sample data; repeat query with count and sum. Scoring weights: Problem understanding 15%, Technical correctness 25%, Reasoning and approach 20%, Practical implementation 25%, Measurement and validation 15%.

The Python verifier creates a new `:memory:` database per submission, enables foreign-key enforcement, denies attach/detach, PRAGMA and virtual-table actions while running candidate SQL, limits SQL length and instruction steps, applies schema/sample/query checks, and runs rollback-only invalid-row probes. The SQL injection application snippet is inspected statically and never executed. This is process-level SQLite isolation, not an operating-system sandbox for arbitrary binaries; no arbitrary host code was run.

## Benchmark results

| ID | Submission | Category | Reference* | Actual | Δ | Schema / seed / query |
|---|---|---|---:|---:|---:|---|
| sql-01 | Excellent implementation | excellent | 100 | 100 | 0 | PASS / PASS / PASS |
| sql-02 | Strong; no nonnegative amount check | strong omission | 91 | 94 | +3 | PASS / PASS / PASS |
| sql-03 | Valid text natural-key alternative | valid alternative | 100 | 100 | 0 | PASS / PASS / PASS |
| sql-04 | Counts distinct dates, not orders | partial | 55 | 55 | 0 | PASS / PASS / PASS |
| sql-05 | Tables without primary keys | design error | 32 | 52 | +20 | PASS / PASS / PASS |
| sql-06 | Missing foreign key | missing FK | 68 | 82 | +14 | PASS / PASS / PASS |
| sql-07 | Foreign key references nonexistent table | invalid FK | 10 | 36 | +26 | PASS / FAIL / PASS |
| sql-08 | Unique child foreign key breaks one-to-many | wrong cardinality | 56 | 51 | -5 | PASS / FAIL / PASS |
| sql-09 | Inappropriate declared types | data types | 45 | 78 | +33 | PASS / PASS / PASS |
| sql-10 | Required fields nullable | missing NOT NULL | 82 | 79 | -3 | PASS / PASS / PASS |
| sql-11 | Syntax error in query | syntax error | 15 | 41 | +26 | PASS / PASS / FAIL |
| sql-12 | Requires three orders instead of two | wrong threshold | 70 | 55 | -15 | PASS / PASS / PASS |
| sql-13 | Self-join multiplies order rows | fan-out | 48 | 55 | +7 | PASS / PASS / PASS |
| sql-14 | Wrong grouping grain and threshold | grouping error | 42 | 55 | +13 | PASS / PASS / PASS |
| sql-15 | Average mislabeled as total spend | aggregation error | 62 | 55 | -7 | PASS / PASS / PASS |
| sql-16 | Unsafe string-interpolated query | injection risk | 75 | 72 | -3 | PASS / PASS / PASS |
| sql-17 | Empty submission | empty | 0 | 0 | 0 | FAIL / FAIL / FAIL |
| sql-18 | Irrelevant response | irrelevant | 0 | 0 | 0 | PASS / FAIL / PASS |
| sql-19 | Keyword-heavy broken schema/query | keyword-heavy wrong | 8 | 17 | +9 | PASS / FAIL / PASS |
| sql-20 | Correlated EXISTS alternative | valid alternative | 100 | 100 | 0 | PASS / PASS / PASS |

*Provisional manually authored reference score; each has a ±5-point tolerance except empty response.*

## All benchmark submissions

### sql-01 — Excellent implementation

**Reference:** 100 (±5) · **Actual:** 100 · **Difference:** 0

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** complete; correct output. **Reference rationale:** Complete design; verified schema, constraints and repeat-customer totals.

**Observed evaluator / execution findings:** No identified technical error. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-02 — Strong; no nonnegative amount check

**Reference:** 91 (±5) · **Actual:** 94 · **Difference:** +3

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** missing nonnegative check. **Reference rationale:** All major requirements pass; negative order totals remain possible.

**Observed evaluator / execution findings:** Negative order totals are accepted.; Negative order totals are accepted.; Negative order totals are accepted.; Negative order totals are accepted. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL);
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-03 — Valid text natural-key alternative

**Reference:** 100 (±5) · **Actual:** 100 · **Difference:** 0

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** valid alternative. **Reference rationale:** Text keys are a valid alternative; evaluation must not require integer IDs.

**Observed evaluator / execution findings:** No identified technical error. **Returned rows:** `[["L","Li",3,5500],["M","Mina",2,24550]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_code TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id TEXT PRIMARY KEY,customer_code TEXT NOT NULL REFERENCES customers(customer_code),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES('M','Mina','m@test'),('R','Ravi','r@test'),('L','Li','l@test'),('N','Nora','n@test'); INSERT INTO orders VALUES('a','M','2026-01-02',10000),('b','M','2026-01-02',14550),('c','R','2026-02-04',900),('d','L','2026-01-10',1000),('e','L','2026-02-10',2000),('f','L','2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_code customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_code=c.customer_code GROUP BY c.customer_code,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_code;
```


### sql-04 — Counts distinct dates, not orders

**Reference:** 55 (±5) · **Actual:** 55 · **Difference:** 0

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** incorrect order identity count. **Reference rationale:** Same-day separate orders collapse; schema itself is sound.

**Observed evaluator / execution findings:** Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_date) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_date)>=2 ORDER BY c.customer_id;
```


### sql-05 — Tables without primary keys

**Reference:** 32 (±5) · **Actual:** 52 · **Difference:** +20

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** no primary keys; no foreign key. **Reference rationale:** Schema lacks keys and integrity; it does not load into the intended validated dataset.

**Observed evaluator / execution findings:** Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER,name TEXT,email TEXT); CREATE TABLE orders(order_id INTEGER,customer_id INTEGER,order_date TEXT,total_cents INTEGER);
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-06 — Missing foreign key

**Reference:** 68 (±5) · **Actual:** 82 · **Difference:** +14

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** orphan rows not prevented. **Reference rationale:** Query works, but orphan orders are accepted.

**Observed evaluator / execution findings:** Missing or invalid orders-to-customers foreign key.; Orphan orders are accepted.; Missing or invalid orders-to-customers foreign key.; Orphan orders are accepted.; Missing or invalid orders-to-customers foreign key.; Orphan orders are accepted.; Missing or invalid orders-to-customers foreign key.; Orphan orders are accepted. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL,order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-07 — Foreign key references nonexistent table

**Reference:** 10 (±5) · **Actual:** 36 · **Difference:** +26

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** invalid foreign key target. **Reference rationale:** Invalid target causes schema/use failure.

**Observed evaluator / execution findings:** sample data error: no such table: main.customer; sample data error: no such table: main.customer; Missing or invalid orders-to-customers foreign key.; Negative order totals are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: no such table: main.customer; Missing or invalid orders-to-customers foreign key.; Negative order totals are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: no such table: main.customer; Missing or invalid orders-to-customers foreign key.; Negative order totals are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: no such table: main.customer; Missing or invalid orders-to-customers foreign key.; Negative order totals are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customer(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-08 — Unique child foreign key breaks one-to-many

**Reference:** 56 (±5) · **Actual:** 51 · **Difference:** -5

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** one-to-one constraint. **Reference rationale:** Uniqueness prevents multiple orders per customer.

**Observed evaluator / execution findings:** sample data error: UNIQUE constraint failed: orders.customer_id; sample data error: UNIQUE constraint failed: orders.customer_id; Query executes but returns an incorrect set, grain, count, or total.; sample data error: UNIQUE constraint failed: orders.customer_id; Query executes but returns an incorrect set, grain, count, or total.; sample data error: UNIQUE constraint failed: orders.customer_id; Query executes but returns an incorrect set, grain, count, or total.; sample data error: UNIQUE constraint failed: orders.customer_id; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-09 — Inappropriate declared types

**Reference:** 45 (±5) · **Actual:** 78 · **Difference:** +33

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** inconsistent types. **Reference rationale:** Declarations are inconsistent and amount safety is unclear; SQLite affinity can mask defects.

**Observed evaluator / execution findings:** Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Expected text and integer-cent types were not verified.; Negative order totals are accepted. **Returned rows:** `[["1","Mina",2,24550],["3","Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id TEXT PRIMARY KEY,name INTEGER NOT NULL,email BLOB NOT NULL UNIQUE); CREATE TABLE orders(order_id TEXT PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date INTEGER NOT NULL,total_cents TEXT NOT NULL);
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-10 — Required fields nullable

**Reference:** 82 (±5) · **Actual:** 79 · **Difference:** -3

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** nullable required fields. **Reference rationale:** Core structure/query work but required columns accept NULL.

**Observed evaluator / execution findings:** Required columns accept NULL or could not be verified.; Required columns accept NULL or could not be verified.; Required columns accept NULL or could not be verified.; Required columns accept NULL or could not be verified. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES customers(customer_id),order_date TEXT,total_cents INTEGER CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-11 — Syntax error in query

**Reference:** 15 (±5) · **Actual:** 41 · **Difference:** +26

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** query syntax error. **Reference rationale:** Schema is usable, but required query cannot execute.

**Observed evaluator / execution findings:** query error: near "(": syntax error; query error: near "(": syntax error; query error: near "(": syntax error; query error: near "(": syntax error; query error: near "(": syntax error **Returned rows:** `[]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.name COUNT(o.order_id) FROM customers c JOIN orders o ON
```


### sql-12 — Requires three orders instead of two

**Reference:** 70 (±5) · **Actual:** 55 · **Difference:** -15

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** wrong qualifying set. **Reference rationale:** Executes but omits Mina, who has exactly two orders.

**Observed evaluator / execution findings:** Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=3 ORDER BY c.customer_id;
```


### sql-13 — Self-join multiplies order rows

**Reference:** 48 (±5) · **Actual:** 55 · **Difference:** +7

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** inflated aggregation. **Reference rationale:** Join fan-out inflates counts and spending.

**Observed evaluator / execution findings:** Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[[1,"Mina",4,49100],[3,"Li",9,16500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id JOIN orders later ON later.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(o.order_id)>=2;
```


### sql-14 — Wrong grouping grain and threshold

**Reference:** 42 (±5) · **Actual:** 55 · **Difference:** +13

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** wrong grain; wrong repeat qualification. **Reference rationale:** Groups by date and includes one-time purchasers, violating output grain.

**Observed evaluator / execution findings:** Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[[1,"Mina","2026-01-02",2,24550],[2,"Ravi","2026-02-04",1,900],[3,"Li","2026-01-10",1,1000],[3,"Li","2026-02-10",1,2000],[3,"Li","2026-03-10",1,2500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,o.order_date,COUNT(o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,o.order_date HAVING COUNT(o.order_id)>=1;
```


### sql-15 — Average mislabeled as total spend

**Reference:** 62 (±5) · **Actual:** 55 · **Difference:** -7

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** average substituted for sum. **Reference rationale:** Correct customer set but incorrect requested measure.

**Observed evaluator / execution findings:** Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[[1,"Mina",2,12275],[3,"Li",3,1833.3333333333333]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,AVG(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```


### sql-16 — Unsafe string-interpolated query

**Reference:** 75 (±5) · **Actual:** 72 · **Difference:** -3

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** unsafe interpolation; do not execute candidate app code. **Reference rationale:** Schema/query artifacts work, but application snippet concatenates untrusted input.

**Observed evaluator / execution findings:** Application snippet interpolates untrusted input; static check only.; Application snippet interpolates untrusted input; static check only.; Application snippet interpolates untrusted input; static check only.; Application snippet interpolates untrusted input; static check only. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,COUNT(DISTINCT o.order_id) order_count,SUM(o.total_cents) total_spend_cents FROM customers c JOIN orders o ON o.customer_id=c.customer_id GROUP BY c.customer_id,c.name HAVING COUNT(DISTINCT o.order_id)>=2 ORDER BY c.customer_id;
```

Application snippet (static inspection only):
```ts
const sql = "SELECT * FROM customers WHERE email = '" + userEmail + "'";
```


### sql-17 — Empty submission

**Reference:** 0 (±0) · **Actual:** 0 · **Difference:** 0

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** empty. **Reference rationale:** No evidence or deliverables.

**Observed evaluator / execution findings:** empty schema; empty schema; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; empty schema; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; empty schema; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; empty schema; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified. **Returned rows:** `[]`

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```


### sql-18 — Irrelevant response

**Reference:** 0 (±5) · **Actual:** 0 · **Difference:** 0

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** irrelevant. **Reference rationale:** No schema, relationship, sample data, or repeat analysis.

**Observed evaluator / execution findings:** sample data error: no such table: customers; sample data error: no such table: customers; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: no such table: customers; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: no such table: customers; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: no such table: customers; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[[1]]`

Schema / DDL:
```sql
-- teamwork, leadership, customer value
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT 1;
```


### sql-19 — Keyword-heavy broken schema/query

**Reference:** 8 (±5) · **Actual:** 17 · **Difference:** +9

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** comments are not evidence; wrong join and grouping. **Reference rationale:** Comments have terminology but no keys/FK; join and grouping are wrong.

**Observed evaluator / execution findings:** sample data error: table customers has 2 columns but 3 values were supplied; sample data error: table customers has 2 columns but 3 values were supplied; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: table customers has 2 columns but 3 values were supplied; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: table customers has 2 columns but 3 values were supplied; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total.; sample data error: table customers has 2 columns but 3 values were supplied; Missing primary key.; Missing or invalid orders-to-customers foreign key.; Required columns accept NULL or could not be verified.; Expected text and integer-cent types were not verified.; Negative order totals are accepted.; Duplicate emails are accepted.; Orphan orders are accepted.; Query executes but returns an incorrect set, grain, count, or total. **Returned rows:** `[]`

Schema / DDL:
```sql
-- customers orders PRIMARY KEY FOREIGN KEY one-to-many NOT NULL repeat customers SUM JOIN GROUP BY
CREATE TABLE customers(id INTEGER,name TEXT); CREATE TABLE orders(id INTEGER,customer_id INTEGER,amount TEXT);
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.name,SUM(o.amount) total_spend_cents FROM customers c JOIN orders o ON o.id=c.id GROUP BY o.amount;
```


### sql-20 — Correlated EXISTS alternative

**Reference:** 100 (±5) · **Actual:** 100 · **Difference:** 0

**Relevant rubric criteria:** Problem understanding, Technical correctness, Reasoning and approach, Practical implementation, Measurement and validation. **Expected technical findings:** valid alternative. **Reference rationale:** Equivalent correlated subqueries produce correct results without reference-query matching.

**Observed evaluator / execution findings:** No identified technical error. **Returned rows:** `[[1,"Mina",2,24550],[3,"Li",3,5500]]`

Schema / DDL:
```sql
CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE); CREATE TABLE orders(order_id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(customer_id),order_date TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0));
```

Sample data:
```sql
INSERT INTO customers VALUES(1,'Mina','m@test'),(2,'Ravi','r@test'),(3,'Li','l@test'),(4,'Nora','n@test'); INSERT INTO orders VALUES(101,1,'2026-01-02',10000),(102,1,'2026-01-02',14550),(103,2,'2026-02-04',900),(104,3,'2026-01-10',1000),(105,3,'2026-02-10',2000),(106,3,'2026-03-10',2500);
```

Query submission:
```sql
SELECT c.customer_id customer_key,c.name customer_name,(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.customer_id) order_count,(SELECT SUM(o.total_cents) FROM orders o WHERE o.customer_id=c.customer_id) total_spend_cents FROM customers c WHERE EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.customer_id GROUP BY o.customer_id HAVING COUNT(*)>=2) ORDER BY c.customer_id;
```


## Score calibration and error analysis

- Mean absolute difference: **9.20/100**.
- Within ±5 points: **10/20 (50.0%)**.
- Within ±10 points: **13/20 (65.0%)**.
- 90% within ±5 target: **NOT MET**.
- Over-scored by more than 10 points: sql-05 (+20), sql-06 (+14), sql-07 (+26), sql-09 (+33), sql-11 (+26), sql-14 (+13).
- Under-scored by more than 10 points: sql-12 (-15).
- Invalid/weak categories receiving ≥70: sql-06 (82), sql-09 (78), sql-10 (79).
- Valid alternatives (text natural key and correlated `EXISTS`) scored sql-03 100/100; sql-20 100/100.

A total of 7 cases differ by more than ten points from the provisional point references. The largest residual patterns are missing-key/relationship designs, invalid foreign-key targets, wrong declared types, and syntax-error queries. References need independent technical review before they can serve as calibration ground truth.

## Errors detected and missed

- Detected: candidate schema creation failures, invalid sample inserts, query syntax/runtime errors, missing PK/FK/required/type constraints, invalid-row acceptance, wrong result sets/counts/totals, same-day date-count bug, fan-out joins, and the authored string-interpolation injection example.
- Missed as a sufficiently severe scoring penalty: `sql-06` missing FK scored 82, `sql-09` declared type mismatch scored 78, and `sql-10` nullable required fields scored 79. These are the three invalid-category cases scoring at least 70 and must be addressed before real candidate use.
- Under-credited: `sql-12` wrong threshold scored 55 against provisional 70. The result-set error is caught, but the score may be too low given the otherwise valid schema and execution.
- Not verified: broad SQL dialect coverage, adversarial SQL sandbox security beyond SQLite authorizer/limits, general SQL injection flows, or unrecognized schema/query aliases.

## Criterion score evidence

The SQL scorer creates five weighted criterion results for every benchmark case and each contains score, evidence, explanation, missing requirements and identified mistakes. It uses executed schema metadata, query status/output, constraint-probe outcomes and static inspection of the provided injection example; it does not count SQL keywords. The overall score is the rounded weighted sum using 15/25/20/25/15.

## Automated tests and build

- `npm run build`: **PASS** (TypeScript project build and Vite production build completed).
- `npm run test:evaluator`: **PASS** — 8 baseline calibration submissions plus 40 cross-role submissions; empty 0, irrelevant 0, weak 23, partial 36, good 66, excellent 100, valid alternative 100, keyword-heavy wrong 7.
- `npm run test:benchmark`: **PASS** — 20 cases executed in isolated SQLite; assertions verify empty/irrelevant/keyword-heavy low scores, excellent answer, two valid alternatives, syntax failure, incorrect thresholds/aggregations, injection feedback and criterion weights. Calibration target itself is not met.
- `npm run lint`: **PASS WITH 3 EXISTING WARNINGS** in `src/App.tsx` (`react(set-state-in-effect`); no new diagnostics remain in evaluator files.
- No browser automation was run; no Playwright/browser test dependency exists in package scripts.
- No Supabase integration, Gemini/Groq API request, deployment, public sharing, or real-user evaluation was performed.

## Bugs and fixes

**Fixed / added:**

- Updated the five app criterion weights to Problem understanding 15%, Technical correctness 25%, Reasoning and approach 20%, Practical implementation 25%, Measurement and validation 15%.
- Added a 20-case SQL benchmark with execution failures, database-design errors, wrong results, valid alternate designs, empty/irrelevant responses, unsafe interpolation and keyword-heavy incorrect SQL.
- Added isolated SQLite execution, schema metadata inspection, foreign-key enforcement and savepoint/rollback invalid-row probes.
- Added deterministic SQL score breakdowns and feedback tied to observed test evidence.
- Added a structured Gemini/Groq provider boundary accepting challenge, hidden rubric, candidate answer, required deliverables and verified test facts. No transport, API key, frontend secret, or claim of a live AI evaluator exists.
- Added benchmark and report generation scripts. Existing LocalStorage assessment and report code were not changed.

**Still failing or limited:**

- Existing app evaluator continues to be regex-based and is not technically executable. SQL benchmark scorer is not integrated into any challenge or app submission flow.
- Current benchmark agreement is only 50.0% within ±5, far below the requested 90%. 7 cases are more than ten points away from provisional expected scores.
- Three invalid-category submissions receive 70+ points: sql-06 82, sql-09 78, sql-10 79. In particular, the missing-FK, type-mismatch and nullable-required-field cases remain too generous and need an independently reviewed reference plus stronger SQL semantics.
- SQLite’s permissive type affinity limits declared-type correctness checks. The runner checks declared types, but does not implement a complete SQL parser or static analyzer.
- Static SQL-injection detection covers the supplied simple string-concatenation example only; it is not a general taint analyzer.
- Benchmark references are provisional and one authored benchmark cannot establish real-world evaluator accuracy.
- Candidate snippets use benchmark-authored SQL and are only executed inside per-case in-memory SQLite databases. This does not qualify arbitrary untrusted code for production execution.
- Existing reports and assessments are browser-local and remain tied to the originating browser profile.

## Readiness

**Gemini integration:** prepared interface only; not implemented or configured. API keys must remain server-side.

**Ready for real candidate testing:** **No.** The application’s current evaluator does not verify technical artifacts. The SQL execution work is a benchmark/test adapter only, and current calibration fails the explicit 90% target. Do not represent scores as AI or as validated hiring measurements.

## Prioritized next steps

1. Have an independent SQL evaluator review all 20 reference scores and expected findings; resolve the 7 >10-point deviations before tuning the scorer.
2. Replace phrase matching for code/SQL tasks with challenge-specific safe execution and assertion-based hidden tests, and keep model judgment separate from verified execution facts.
3. Extend SQL validation with additional fixed datasets and edge cases (same-day orders, orphan rows, duplicate keys, NULLs, empty tables, repeated submissions) and verify constraints using schema-aware probes.
4. Add an authenticated server-side evaluator provider endpoint for Gemini/Groq; validate JSON schema, preserve execution facts, keep credentials server-only, and record uncertainty.
5. Integrate the SQL challenge and score evidence into assessment/report flow only after benchmark calibration and regression review.

---

This report records tests actually executed in the local project on the generated benchmark. It does not claim scientific validity, production safety, public report sharing, or model-based evaluation.
