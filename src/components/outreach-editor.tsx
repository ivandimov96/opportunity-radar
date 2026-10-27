"use client";
import { useMemo, useState } from "react";
import { Icon } from "./icons";

export interface ClaimView {
  text: string;
  supported: boolean;
  evidence: { statement: string; sourceUrl: string | null }[];
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function highlight(body: string, claims: ClaimView[]) {
  // Mark claim phrases (case-insensitive, first occurrence each) without overlapping.
  const ranges: { start: number; end: number; supported: boolean }[] = [];
  const lower = body.toLowerCase();
  for (const c of claims) {
    const needle = c.text.trim().toLowerCase();
    if (needle.length < 4) continue;
    const idx = lower.indexOf(needle);
    if (idx === -1) continue;
    const end = idx + needle.length;
    if (ranges.some((r) => idx < r.end && end > r.start)) continue;
    ranges.push({ start: idx, end, supported: c.supported });
  }
  ranges.sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const r of ranges) {
    out += escapeHtml(body.slice(pos, r.start));
    out += `<mark class="${r.supported ? "claim" : "claim-unsupported"}">${escapeHtml(body.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  }
  out += escapeHtml(body.slice(pos));
  return out.replace(/\n/g, "<br/>");
}

export function OutreachEditor({ draftId, businessId, subject, body, claims, status, action }: { draftId: string; businessId: string; subject: string; body: string; claims: ClaimView[]; status: string; action: (fd: FormData) => void | Promise<void> }) {
  const [text, setText] = useState(body);
  const [subj, setSubj] = useState(subject);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [copied, setCopied] = useState(false);
  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);
  const html = useMemo(() => highlight(text, claims), [text, claims]);
  const dirty = text !== body || subj !== subject;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subj}\n\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <form action={action} className="grid lg:grid-cols-[1fr_300px] gap-5">
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="businessId" value={businessId} />
      <div className="space-y-3 min-w-0">
        <div>
          <label className="label">Subject</label>
          <input className="input" name="subject" value={subj} onChange={(e) => setSubj(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Message</label>
            <div className="flex items-center gap-1 text-xs">
              <button type="button" className={`chip h-7 ${mode === "preview" ? "chip-active" : ""}`} onClick={() => setMode("preview")}>
                <Icon name="eye" className="w-3.5 h-3.5" /> Evidence view
              </button>
              <button type="button" className={`chip h-7 ${mode === "edit" ? "chip-active" : ""}`} onClick={() => setMode("edit")}>
                <Icon name="note" className="w-3.5 h-3.5" /> Edit
              </button>
            </div>
          </div>
          {mode === "edit" ? (
            <textarea className="textarea font-mono text-xs leading-relaxed" name="body" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <>
              <textarea className="hidden" name="body" value={text} readOnly />
              <div className="rounded-[var(--radius-sm)] border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed min-h-[200px]" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          )}
          <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink-faint">
            <span>
              {words} words · <mark className="claim">supported claim</mark> · <mark className="claim-unsupported">unsupported claim</mark>
            </span>
            {dirty && <span className="text-warn">Unsaved edits</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn btn-primary" name="status" value="approved">
            <Icon name="check" /> {status === "approved" ? "Save" : "Approve for sending"}
          </button>
          <button className="btn" name="status" value={status === "archived" ? "draft" : status}>
            Save edits
          </button>
          <button type="button" className="btn" onClick={copy}>
            <Icon name="copy" /> {copied ? "Copied" : "Copy to clipboard"}
          </button>
          <button className="btn btn-ghost ml-auto" name="status" value="archived">
            Archive
          </button>
        </div>
      </div>
      <aside className="space-y-2">
        <div className="label">Claims → evidence</div>
        {claims.length === 0 && <p className="text-xs text-ink-faint">No company-specific claims recorded.</p>}
        {claims.map((c, i) => (
          <div key={i} className={`rounded-[var(--radius-sm)] border px-3 py-2 text-xs ${c.supported ? "border-ok/30 bg-ok-soft" : "border-warn/30 bg-warn-soft"}`}>
            <div className="font-medium">“{c.text}”</div>
            <ul className="mt-1 space-y-0.5 text-ink-muted">
              {c.evidence.map((e, j) => (
                <li key={j} className="flex gap-1">
                  <span>↳</span>
                  <span>
                    {e.statement}{" "}
                    {e.sourceUrl && (
                      <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
                        source <Icon name="external" className="w-3 h-3" />
                      </a>
                    )}
                  </span>
                </li>
              ))}
              {!c.supported && <li className="text-warn font-medium">No verified observation supports this. Edit or remove it.</li>}
            </ul>
          </div>
        ))}
      </aside>
    </form>
  );
}
