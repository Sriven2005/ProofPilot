import type { CriterionScore } from '../types';
import './CriterionEvidencePanel.css';

export function CriterionEvidencePanel({ criteria }: { criteria: CriterionScore[] }) {
  return <section className="criterion-evidence-panel" aria-label="Criterion evidence">
    <div className="section-label">CRITERION EVIDENCE</div>
    {criteria.map(item => <details key={item.name}>
      <summary><span>{item.name}</span><strong>{item.score}<small>/100 · {item.weight}%</small></strong></summary>
      <p>{item.note}</p>
      {item.evidence.length > 0 && <div><b>Evidence</b><ul>{item.evidence.map((value,index)=><li key={index}>{value}</li>)}</ul></div>}
      {item.missing.length > 0 && <div><b>Missing</b><ul>{item.missing.map((value,index)=><li key={index}>{value}</li>)}</ul></div>}
      {item.incorrect.length > 0 && <div><b>Incorrect</b><ul>{item.incorrect.map((value,index)=><li key={index}>{value}</li>)}</ul></div>}
    </details>)}
  </section>;
}
