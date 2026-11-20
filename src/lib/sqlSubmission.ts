export interface SqlSubmissionParts { schema: string; seed: string; query: string; reasoning: string; }

const sectionFor = (line: string): keyof SqlSubmissionParts | undefined => {
  const match=line.match(/^\s*(?:--|#{1,6}|\/\*+|\*)?\s*(schema|ddl|tables|sample data|seed|inserts?|query|sql query|reasoning|explanation)\s*:?\s*(?:\*\/)?\s*$/i);
  if (!match) return undefined;
  const label=match[1].toLowerCase();
  if (['schema','ddl','tables'].includes(label)) return 'schema';
  if (['sample data','seed','insert','inserts'].includes(label)) return 'seed';
  if (['query','sql query'].includes(label)) return 'query';
  return 'reasoning';
};

/** Parse only labeled SQL sections; free-form text is retained as reasoning and never sent to SQLite. */
export function parseSqlSubmission(answer: string): SqlSubmissionParts {
  const parts: SqlSubmissionParts={schema:'',seed:'',query:'',reasoning:''};
  let current:keyof SqlSubmissionParts|undefined;
  const lines=answer.replace(/```(?:sql|sqlite|text)?/gi,'').split(/\r?\n/);
  let foundSection=false;
  for (const line of lines) {
    const next=sectionFor(line);
    if (next) { current=next; foundSection=true; continue; }
    if (line.trim()==='```') continue;
    if (current) parts[current]+=(parts[current]?'\n':'')+line;
    else if (line.trim()) parts.reasoning+=(parts.reasoning?'\n':'')+line;
  }
  if (foundSection) return Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.trim()])) as SqlSubmissionParts;

  // Unlabeled SQL is divided by statement kind; all non-SQL prose remains reasoning.
  const clean=answer.replace(/```(?:sql|sqlite)?|```/gi,'');
  const statements=clean.split(/;\s*/).map(s=>s.trim()).filter(Boolean);
  for (const statement of statements) {
    const first=statement.replace(/^(?:\s*--[^\n]*\n\s*)+/,'').trim();
    if (/^(?:CREATE|ALTER|DROP)\b/i.test(first)) parts.schema+=(parts.schema?'\n':'')+statement+';';
    else if (/^(?:INSERT|UPDATE|DELETE)\b/i.test(first)) parts.seed+=(parts.seed?'\n':'')+statement+';';
    else if (/^(?:SELECT|WITH)\b/i.test(first)) parts.query+=(parts.query?'\n':'')+statement+';';
    else if (statement) parts.reasoning+=(parts.reasoning?'\n':'')+statement;
  }
  return parts;
}
