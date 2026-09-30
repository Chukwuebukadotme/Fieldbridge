"""FieldBridge: Integration Readiness Workbench (interview prototype).

Run with:  streamlit run app.py
"""

from __future__ import annotations

from html import escape
from pathlib import Path

import pandas as pd
import streamlit as st

from exporter import build_brief
from inputs import LoadedFile, parse_dictionary, parse_requirements
from mapping_engine import MappingEngineError, generate_mappings, live_ai_status, model_name
from models import APPROVED, BLOCKED, MISSING, READY, REVIEW, TARGET_FIELDS, Mapping, MappingEvaluation
from review import (
    STATUS_ICONS,
    Workspace,
    add_question,
    approve,
    build_test_plan,
    build_workspace,
    correct,
    next_issue,
    readiness,
    reject,
    risk_sorted,
    rule_questions,
    set_question_resolved,
    unresolved,
)
from rules import can_approve, evaluate_mapping
from transformations import REGISTRY

HERE = Path(__file__).parent
SAMPLE_REQUIREMENTS = HERE / "sample_requirements.txt"
SAMPLE_DICTIONARY = HERE / "sample_data_dictionary.csv"
STEPS = ["Upload", "Map and review", "Validate", "Approve and export"]
STATUS_CLASS = {READY: "ready", REVIEW: "review", MISSING: "missing", BLOCKED: "blocked", APPROVED: "approved"}

st.set_page_config(page_title="FieldBridge Workbench", page_icon=":material/account_tree:", layout="wide",
                   initial_sidebar_state="collapsed")

CSS = """
<style>
:root {
  --fb-blue:#1F5FBF; --fb-blue-bg:#EAF1FB; --fb-text:#1B2430; --fb-muted:#556070; --fb-border:#D8DEE6;
  --fb-green:#1B6E35; --fb-green-bg:#E7F4EA; --fb-green-bd:#B5DABF;
  --fb-amber:#7A4700; --fb-amber-bg:#FFF4DA; --fb-amber-bd:#EFCF86;
  --fb-red:#A3190F; --fb-red-bg:#FDECEA; --fb-red-bd:#F0B6B0;
}
.block-container { padding-top: 3.2rem; padding-bottom: 3rem; max-width: 1440px; }
*:focus-visible { outline: 3px solid var(--fb-blue) !important; outline-offset: 2px !important; }
code { color: var(--fb-text) !important; background: #EEF1F5 !important; font-size: .86em !important; }
h1, h2, h3 { color: var(--fb-text); letter-spacing: -0.01em; }

/* White working surfaces */
[class*="st-key-card_"] { background:#fff; border:1px solid var(--fb-border); border-radius:10px; padding:1.1rem 1.2rem; }

/* Header */
.fb-header { display:flex; align-items:baseline; gap:.75rem; flex-wrap:wrap; margin-bottom:.35rem; }
.fb-brand { font-size:1.45rem; font-weight:700; color:var(--fb-text); }
.fb-sub { color:var(--fb-muted); font-size:1rem; }
.fb-tag { font-size:.75rem; font-weight:600; color:var(--fb-muted); border:1px solid var(--fb-border); background:#fff; padding:.1rem .5rem; border-radius:999px; }

/* Stepper */
.fb-stepper ol { display:flex; list-style:none; margin:.4rem 0 1.4rem 0; padding:0; gap:.5rem; }
.fb-stepper li { flex:1; display:flex; align-items:center; gap:.55rem; padding:.6rem .8rem; background:#fff; border:1px solid var(--fb-border); border-radius:8px; color:var(--fb-muted); font-weight:500; font-size:.95rem; margin:0; }
.fb-stepper li .n { display:inline-flex; width:1.6rem; height:1.6rem; border-radius:50%; align-items:center; justify-content:center; font-size:.85rem; font-weight:700; border:1.5px solid var(--fb-border); background:#F4F6F9; flex-shrink:0; }
.fb-stepper li.done { color:var(--fb-text); }
.fb-stepper li.done .n { background:var(--fb-green-bg); border-color:var(--fb-green-bd); color:var(--fb-green); }
.fb-stepper li.current { border-color:var(--fb-blue); box-shadow: inset 0 -3px 0 var(--fb-blue); color:var(--fb-text); font-weight:650; }
.fb-stepper li.current .n { background:var(--fb-blue); border-color:var(--fb-blue); color:#fff; }
.fb-stepper .state { font-size:.75rem; font-weight:500; color:var(--fb-muted); margin-left:auto; }

/* Status badges: icon + text, never colour alone */
.fb-badge { display:inline-flex; align-items:center; gap:.3rem; padding:.12rem .55rem; border-radius:999px; font-size:.8rem; font-weight:650; border:1px solid; white-space:nowrap; line-height:1.4; }
.fb-ready { color:var(--fb-green); background:var(--fb-green-bg); border-color:var(--fb-green-bd); }
.fb-review { color:var(--fb-amber); background:var(--fb-amber-bg); border-color:var(--fb-amber-bd); }
.fb-missing, .fb-blocked { color:var(--fb-red); background:var(--fb-red-bg); border-color:var(--fb-red-bd); }
.fb-approved { color:#fff; background:var(--fb-green); border-color:var(--fb-green); }

.fb-muted { color:var(--fb-muted); font-size:.9rem; }
.fb-label { font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--fb-muted); margin:.9rem 0 .3rem 0; }
.fb-card-title { font-size:1.05rem; font-weight:650; color:var(--fb-text); }
.fb-file { display:flex; gap:.8rem; align-items:flex-start; }
.fb-file-icon { font-size:.72rem; font-weight:800; color:var(--fb-blue); background:var(--fb-blue-bg); border-radius:6px; padding:.55rem .45rem; min-width:2.6rem; text-align:center; }
.fb-file-name { font-weight:650; color:var(--fb-text); word-break:break-all; }

/* Mapping table */
.fb-th { font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--fb-muted); }
[class*="st-key-maprow_"] { border-top:1px solid var(--fb-border); padding:.55rem .4rem; border-radius:6px; }
[class*="st-key-maprow_"] code { font-size:.8em !important; }
[class*="st-key-maprow_"] .fb-badge { font-size:.76rem; }
[class*="st-key-maprow_sel_"] { background:var(--fb-blue-bg); box-shadow: inset 3px 0 0 var(--fb-blue); }
[class*="st-key-open_"] button { text-align:left; justify-content:flex-start; }
[class*="st-key-open_"] button p { text-decoration: underline; text-underline-offset: 3px; white-space: normal; text-align: left; }
.fb-none { color:var(--fb-red); font-style:italic; font-size:.9rem; }

/* Evidence panel */
.fb-quote { border-left:3px solid var(--fb-blue); background:#F7F9FC; padding:.6rem .8rem; margin:.2rem 0 .35rem 0; color:var(--fb-text); font-size:.95rem; }
.fb-verify { font-size:.82rem; font-weight:600; }
.fb-verify.ok { color:var(--fb-green); } .fb-verify.bad { color:var(--fb-red); }
.fb-kv { width:100%; border-collapse:collapse; font-size:.88rem; }
.fb-kv td, .fb-kv th { border-bottom:1px solid #EDF0F4; padding:.35rem .4rem; text-align:left; vertical-align:top; }
.fb-kv th { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; color:var(--fb-muted); font-weight:700; }
.fb-reason { border-radius:8px; padding:.6rem .8rem; font-size:.9rem; margin:.5rem 0; border:1px solid; }
.fb-reason ul { margin:.2rem 0 0 1rem; padding:0; }
.fb-reason.ready, .fb-reason.approved { background:var(--fb-green-bg); border-color:var(--fb-green-bd); }
.fb-reason.review { background:var(--fb-amber-bg); border-color:var(--fb-amber-bd); }
.fb-reason.missing, .fb-reason.blocked { background:var(--fb-red-bg); border-color:var(--fb-red-bd); }
.fb-checklist { list-style:none; margin:0; padding:0; font-size:.86rem; }
.fb-checklist li { display:flex; gap:.5rem; align-items:flex-start; padding:.28rem 0; border-bottom:1px solid #F0F2F5; }
.fb-checklist .fix { color:var(--fb-muted); font-size:.8rem; }

/* Rule table */
.fb-rules { width:100%; border-collapse:collapse; font-size:.88rem; background:#fff; }
.fb-rules th { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; color:var(--fb-muted); padding:.5rem; border-bottom:2px solid var(--fb-border); }
.fb-rules td { padding:.6rem .5rem; border-bottom:1px solid #EDF0F4; vertical-align:top; }
.fb-rules td.what { color:var(--fb-muted); }

/* Readiness banner */
.fb-banner { border-radius:10px; padding:1rem 1.2rem; border:1px solid; margin-bottom:1rem; }
.fb-banner h3 { margin:0 0 .25rem 0; font-size:1.15rem; }
.fb-banner.not-ready { background:var(--fb-amber-bg); border-color:var(--fb-amber-bd); border-left:6px solid #C27C00; }
.fb-banner.ready { background:var(--fb-green-bg); border-color:var(--fb-green-bd); border-left:6px solid var(--fb-green); }
</style>
"""


# --- State --------------------------------------------------------------------------------


def init_state() -> None:
    ss = st.session_state
    ss.setdefault("step", 1)
    ss.setdefault("req_file", None)
    ss.setdefault("dict_file", None)
    ss.setdefault("workspace", None)
    ss.setdefault("selected", None)
    ss.setdefault("nonce", {"req": 0, "dict": 0})
    ss.setdefault("flash", [])
    ss.setdefault("mode", "Demo mode")


def ws() -> Workspace | None:
    return st.session_state.workspace


def flash(kind: str, message: str) -> None:
    st.session_state.flash.append((kind, message))


def go(step: int) -> None:
    st.session_state.step = step


def inputs_changed() -> None:
    if st.session_state.workspace is not None:
        flash("info", "Inputs changed. Generate proposals again to review the new files.")
    st.session_state.workspace = None
    st.session_state.selected = None


# --- Small rendering helpers ------------------------------------------------------------------


def badge(status: str) -> str:
    return f'<span class="fb-badge fb-{STATUS_CLASS[status]}">{STATUS_ICONS[status]} {escape(status)}</span>'


def code(text: str) -> str:
    # <wbr> lets long snake_case names wrap at underscores instead of mid-word.
    return f"<code>{escape(text).replace('_', '_<wbr>')}</code>"


def decision_label(decision: str) -> str:
    icon = {"Pending": "", "Approved": "✔ ", "Rejected": "✕ "}[decision]
    style = "color:var(--fb-muted)" if decision == "Pending" else "font-weight:600"
    return f"<span style='white-space:nowrap;{style}'>{icon}{decision}</span>"


def html(markup: str) -> None:
    st.markdown(markup, unsafe_allow_html=True)


def label(text: str) -> None:
    html(f'<div class="fb-label">{escape(text)}</div>')


def render_header() -> None:
    html(
        '<div class="fb-header"><span class="fb-brand">FieldBridge</span>'
        '<span class="fb-sub">Integration Readiness Workbench</span>'
        '<span class="fb-tag">Prototype · fictional data · Northstar Lending</span></div>'
    )
    current = st.session_state.step
    items = []
    for i, name in enumerate(STEPS, start=1):
        cls = "done" if i < current else "current" if i == current else ""
        mark = "✓" if i < current else str(i)
        state = "Complete" if i < current else "Current step" if i == current else "Not started"
        aria = ' aria-current="step"' if i == current else ""
        items.append(f'<li class="{cls}"{aria}><span class="n" aria-hidden="true">{mark}</span>{escape(name)}<span class="state">{state}</span></li>')
    html(f'<nav class="fb-stepper" aria-label="Workflow progress"><ol>{"".join(items)}</ol></nav>')


def step_title(title: str, intro: str) -> None:
    st.markdown(f"### {title}")
    html(f'<p class="fb-muted" style="margin-top:-.4rem">{intro}</p>')


def show_flash() -> None:
    for kind, message in st.session_state.flash:
        if kind == "toast":
            st.toast(message)
        elif kind == "warning":
            st.warning(message, icon=":material/warning:")
        elif kind == "error":
            st.error(message, icon=":material/error:")
        else:
            st.info(message, icon=":material/info:")
    st.session_state.flash = []


def render_sidebar() -> None:
    with st.sidebar:
        st.markdown("**FieldBridge**  \nIntegration Readiness Workbench")
        st.caption(
            "Interview prototype. Every organisation, requirement and record is fictional. "
            "Not an Experian product. It makes no lending decisions."
        )
        st.divider()
        st.markdown("**How decisions are made**")
        st.markdown("1. AI interprets requirements and **proposes** mappings.\n"
                    "2. Deterministic Python **checks and transforms**.\n"
                    "3. A person **decides**.")
        st.divider()
        workspace = ws()
        available, why = live_ai_status()
        st.markdown("**Session**")
        st.caption(f"Proposals: {workspace.mapping_source if workspace else 'not generated yet'}")
        st.caption(f"Live AI: {'available · ' + why if available else 'unavailable · ' + why}")
        st.caption("Reviewer: Demo reviewer")
        if st.button("Start over", icon=":material/restart_alt:", width="stretch"):
            for key in list(st.session_state.keys()):
                del st.session_state[key]
            st.rerun()


def require_workspace() -> Workspace | None:
    workspace = ws()
    if workspace is None:
        with st.container(key="card_empty"):
            st.markdown("**No mapping proposals yet.**")
            st.markdown("Load the requirements and data dictionary, then generate proposals.")
            st.button("Go to Upload", on_click=go, args=(1,), type="primary")
    return workspace


# --- Step 1: Upload ----------------------------------------------------------------------------


def load_sample() -> None:
    try:
        req_raw, dict_raw = SAMPLE_REQUIREMENTS.read_bytes(), SAMPLE_DICTIONARY.read_bytes()
    except FileNotFoundError as exc:
        flash("error", f"Sample file not found: {Path(exc.filename).name}. Check the project folder.")
        return
    st.session_state.req_file = parse_requirements(SAMPLE_REQUIREMENTS.name, req_raw, "sample")
    st.session_state.dict_file = parse_dictionary(SAMPLE_DICTIONARY.name, dict_raw, "sample")
    inputs_changed()
    flash("toast", "Fictional sample loaded.")


def on_upload(kind: str) -> None:
    ss = st.session_state
    uploaded = ss.get(f"upload_{kind}_{ss.nonce[kind]}")
    if uploaded is None:
        return
    parser = parse_requirements if kind == "req" else parse_dictionary
    try:
        ss[f"{kind}_file"] = parser(uploaded.name, uploaded.getvalue(), "upload")
    except Exception as exc:  # never crash on a malformed upload
        ss[f"{kind}_file"] = LoadedFile(name=uploaded.name, kind=kind, file_type="Unknown", origin="upload", ok=False, error=str(exc))
    inputs_changed()


def replace_file(kind: str) -> None:
    ss = st.session_state
    ss[f"{kind}_file"] = None
    ss.nonce[kind] += 1
    inputs_changed()


def file_card(kind: str, title: str, hint: str, extension: str) -> None:
    loaded: LoadedFile | None = st.session_state[f"{kind}_file"]
    noun = "requirements" if kind == "req" else "fields"
    with st.container(key=f"card_{kind}"):
        html(f'<div class="fb-card-title">{escape(title)}</div><div class="fb-muted">{escape(hint)}</div>')
        if loaded is None:
            st.file_uploader(
                f"Upload {title}",
                type=[extension],
                key=f"upload_{kind}_{st.session_state.nonce[kind]}",
                on_change=on_upload,
                args=(kind,),
                label_visibility="collapsed",
            )
            return
        status = badge(READY).replace("Ready", "Parsed") if loaded.ok else badge(BLOCKED).replace("Blocked", "Failed")
        detected = f"{loaded.count} {noun} detected" if loaded.ok else "Nothing detected"
        html(
            f'<div class="fb-file" style="margin-top:.8rem"><div class="fb-file-icon">.{extension.upper()}</div><div>'
            f'<div class="fb-file-name">{escape(loaded.name)}</div>'
            f'<div class="fb-muted">{escape(loaded.file_type)} · {"Fictional sample" if loaded.origin == "sample" else "Uploaded"} · {detected}</div>'
            f'<div style="margin-top:.35rem">{status}</div></div></div>'
        )
        if loaded.error:
            st.error(loaded.error, icon=":material/error:")
        for warning in loaded.warnings:
            st.caption(f"⚠ {warning}")
        if loaded.ok:
            with st.expander("Preview parsed contents"):
                if kind == "req":
                    st.dataframe(pd.DataFrame([{"ID": r.id, "Line": r.line, "Requirement": r.text} for r in loaded.requirements]),
                                 hide_index=True, width="stretch")
                else:
                    st.dataframe(pd.DataFrame([f.model_dump() for f in loaded.fields]), hide_index=True, width="stretch")
        st.button("Replace file", key=f"replace_{kind}", icon=":material/swap_horiz:", on_click=replace_file, args=(kind,))


def run_generation(use_live: bool) -> None:
    ss = st.session_state
    req, dictionary = ss.req_file, ss.dict_file
    message = f"Requesting proposals from {model_name()}…" if use_live else "Loading Demo-mode proposals…"
    with st.spinner(message):
        try:
            result = generate_mappings(use_live, req.text, dictionary.fields, TARGET_FIELDS)
        except MappingEngineError as exc:
            st.error(f"Could not load mapping proposals: {exc}", icon=":material/error:")
            return
    workspace = build_workspace(req, dictionary, TARGET_FIELDS, result)
    ss.workspace = workspace
    first = risk_sorted(workspace, workspace.evaluate())[0]
    ss.selected = first.target_field
    if result.notice:
        flash("warning", result.notice)
    if result.origin == "demo" and (req.origin != "sample" or dictionary.origin != "sample"):
        flash("info", "Demo mode replays saved proposals for the fictional sample. Rule checks will flag anything that "
                      "does not fit your files; correct those mappings manually or use Live AI.")
    ss.step = 2
    st.rerun()


def step_upload() -> None:
    ss = st.session_state
    req, dictionary = ss.req_file, ss.dict_file
    both_ok = bool(req and dictionary and req.ok and dictionary.ok)

    head, action = st.columns([3, 1], vertical_alignment="bottom")
    with head:
        step_title("Load lender inputs",
                   "Add Northstar Lending's requirements (.txt) and data dictionary (.csv). "
                   "Files are parsed locally. In Demo mode nothing leaves this machine.")
    with action:
        if not both_ok:
            st.button("Use fictional sample", type="primary", icon=":material/science:", on_click=load_sample, width="stretch")

    left, right = st.columns(2, gap="medium")
    with left:
        file_card("req", "Requirements document", "Plain text, one requirement per line, e.g. “R1: …”.", "txt")
    with right:
        file_card("dict", "Data dictionary", "CSV with field_name, data_type, description, unit, sample_value.", "csv")

    st.write("")
    with st.container(key="card_targets"):
        html('<div class="fb-card-title">What the destination workflow requires</div>'
             '<div class="fb-muted">Required target fields for the fictional credit-decisioning workflow.</div>')
        rows = "".join(
            f"<tr><td>{code(t.name)}</td><td>{escape(t.data_type)}</td><td>{escape(t.unit)}</td>"
            f"<td>{'Yes' if t.required else 'No'}</td><td>{escape(t.description)}</td></tr>"
            for t in TARGET_FIELDS
        )
        html(f'<table class="fb-kv" style="margin-top:.6rem"><tr><th>Target field</th><th>Type</th><th>Unit</th>'
             f"<th>Required</th><th>Meaning</th></tr>{rows}</table>")

    st.write("")
    available, why = live_ai_status()
    live_caption = f"Calls OpenAI ({model_name()}). Falls back to Demo mode on any failure." if available \
        else f"Unavailable ({why}) Selecting it will fall back to Demo mode."
    mode = st.radio(
        "Mapping proposals",
        ["Demo mode", "Live AI"],
        key="mode",
        horizontal=True,
        captions=["Replays a saved, validated response (sample_mappings.json). No API key needed.", live_caption],
    )

    if both_ok:
        if ss.workspace is not None:
            st.caption("Generating again replaces the current proposals, decisions and audit history.")
        if st.button("Generate mapping proposals", type="primary", icon=":material/arrow_forward:"):
            run_generation(mode == "Live AI")
    else:
        missing = [n for n, f in (("requirements document", req), ("data dictionary", dictionary)) if not (f and f.ok)]
        st.button("Generate mapping proposals", disabled=True, icon=":material/arrow_forward:")
        st.caption(f"Load a valid {' and '.join(missing)} to continue, or use the fictional sample.")
    if ss.workspace is not None:
        st.button("Return to current review", on_click=go, args=(2,))


# --- Step 2: Map and review ----------------------------------------------------------------------


def select(target: str) -> None:
    st.session_state.selected = target


def review_next() -> None:
    workspace = ws()
    target = next_issue(workspace, workspace.evaluate(), st.session_state.selected)
    if target is None:
        flash("toast", "No unresolved mappings remain.")
    else:
        st.session_state.selected = target


def do_approve(target: str) -> None:
    try:
        approve(ws(), target)
        flash("toast", f"Approved {target}.")
    except ValueError as exc:
        flash("error", str(exc))


def do_reject(target: str) -> None:
    reason = st.session_state.get(f"reject_reason_{target}", "")
    reject(ws(), target, reason)
    flash("toast", f"Rejected {target}. It stays Blocked until corrected.")


COLS = [2.6, 2.2, 2.1, 2.2, 1.4]


def mapping_table(workspace: Workspace, evaluations: dict[str, MappingEvaluation]) -> None:
    with st.container(key="card_table"):
        headers = st.columns(COLS)
        for col, text in zip(headers, ["Target field", "Suggested source", "Transform&shy;ation", "Status", "Reviewer decision"]):
            col.markdown(f'<span class="fb-th">{text}</span>', unsafe_allow_html=True)
        for m in risk_sorted(workspace, evaluations):
            selected = m.target_field == st.session_state.selected
            with st.container(key=f"maprow_{'sel_' if selected else ''}{m.target_field}"):
                c = st.columns(COLS, vertical_alignment="center")
                # Zero-width spaces after underscores let long names wrap between words.
                c[0].button(f"`{m.target_field.replace('_', '_' + chr(0x200B))}`", key=f"open_{m.target_field}", on_click=select, args=(m.target_field,),
                            type="tertiary", help=f"Show evidence for {m.target_field}", wrap=True)
                sources = "<br>".join(code(f) for f in m.source_fields) or '<span class="fb-none">None found</span>'
                c[1].markdown(sources, unsafe_allow_html=True)
                c[2].markdown(code(m.transformation_id), unsafe_allow_html=True)
                c[3].markdown(badge(evaluations[m.target_field].status), unsafe_allow_html=True)
                c[4].markdown(decision_label(m.decision), unsafe_allow_html=True)


def evidence_panel(workspace: Workspace, evaluations: dict[str, MappingEvaluation], target: str) -> None:
    m = workspace.mapping(target)
    ev = evaluations[target]

    with st.container(key="card_evidence"):
        html(f'<div class="fb-label" style="margin-top:0">Evidence panel</div>'
             f'<div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">'
             f'<span style="font-size:1.15rem;font-weight:700">{code(target)}</span>{badge(ev.status)}</div>')
        reasons = "".join(f"<li>{escape(r)}</li>" for r in ev.reasons)
        html(f'<div class="fb-reason {STATUS_CLASS[ev.status]}"><strong>Why {escape(ev.status)}</strong><ul>{reasons}</ul></div>')

        issues = sum(1 for c in ev.checks if c.status != READY)
        tab_labels = ["Evidence", f"Rule checks ({issues} open)" if issues else "Rule checks (all ready)", "Correct mapping"]
        evidence_tab, checks_tab, correct_tab = st.tabs(
            tab_labels, default=tab_labels[2] if m.decision == "Rejected" else tab_labels[0], key=f"panel_tabs_{target}_{m.decision}"
        )
        with evidence_tab:
            evidence_details(workspace, m, ev)
        with checks_tab:
            items = []
            for c in ev.checks:
                fix = f"<div class='fix'>{escape(c.remediation)}</div>" if c.remediation and not c.evidence.startswith("Not run") else ""
                note = f"<div class='fix'>{escape(c.evidence)}</div>" if c.evidence.startswith("Not run") else ""
                items.append(f"<li>{badge(c.status)}<div><strong>{c.number}. {escape(c.name)}</strong>{fix}{note}</div></li>")
            html(f"<ul class='fb-checklist'>{''.join(items)}</ul>")
            st.caption("Full evidence for each check is in step 3, Validate.")
        with correct_tab:
            correction_form(workspace, target)

        label("Reviewer decision")
        approvable = can_approve(ev, m)
        a, r = st.columns(2)
        a.button("Approve mapping", key=f"approve_{target}", icon=":material/check:", disabled=not approvable,
                 on_click=do_approve, args=(target,), width="stretch")
        with r.popover("Reject…", icon=":material/close:", disabled=m.decision == "Rejected", width="stretch"):
            st.text_input("Reason (optional)", key=f"reject_reason_{target}")
            st.button("Confirm rejection", key=f"confirm_reject_{target}", on_click=do_reject, args=(target,))
        if m.decision == "Approved":
            st.caption("Approved. Editing the mapping resets the decision to Pending.")
        elif m.decision == "Rejected":
            st.caption("Rejected. The mapping stays Blocked until it is corrected in the Correct mapping tab.")
        elif not approvable:
            st.caption("Approval is disabled until the Missing or Blocked findings are resolved.")


def evidence_details(workspace: Workspace, m: Mapping, ev: MappingEvaluation) -> None:
    ctx = workspace.context()
    target = m.target_field
    tgt = ctx.targets[target]
    spec = REGISTRY.get(m.transformation_id)

    evidence_check = next(c for c in ev.checks if c.number == 5)
    requirement = ctx.requirements.get(m.requirement_id)
    label(f"Requirement {m.requirement_id or '(none cited)'}")
    html(f'<div class="fb-quote">{escape(m.evidence_quote) or "<em>No evidence quoted.</em>"}</div>')
    if evidence_check.status == READY:
        html(f'<div class="fb-verify ok">✓ Found verbatim in {escape(workspace.requirements_name)}, line {requirement.line if requirement else "?"}</div>')
    else:
        html(f'<div class="fb-verify bad">✕ {escape(evidence_check.evidence)}</div>')

    label("Source → target")
    source_rows = "".join(
        f"<tr><td>{code(f)}</td><td>{escape(ctx.dictionary[f].description) if f in ctx.dictionary else '<em>Not in dictionary</em>'}</td>"
        f"<td>{escape(ctx.dictionary[f].data_type) if f in ctx.dictionary else '—'}</td>"
        f"<td>{escape(ctx.dictionary[f].unit) if f in ctx.dictionary else '—'}</td></tr>"
        for f in m.source_fields
    ) or '<tr><td colspan="4"><span class="fb-none">No source field identified</span></td></tr>'
    html(
        f'<table class="fb-kv"><tr><th>Source field</th><th>Description</th><th>Type</th><th>Unit</th></tr>{source_rows}'
        f'<tr><td colspan="4" style="border:none;padding-top:.6rem"><span class="fb-th">Proposed target</span></td></tr>'
        f"<tr><td>{code(tgt.name)}</td><td>{escape(tgt.description)}</td><td>{escape(tgt.data_type)}</td><td>{escape(tgt.unit)}</td></tr></table>"
    )

    label("Transformation")
    formula = spec.formula if spec else "Not an approved transformation. It will not be run."
    html(f"{code(m.transformation_id)} <span class='fb-muted'>{escape(formula)}</span>")

    label("Sample preview (before → after)")
    preview = ev.preview
    before = "<br>".join(f"{code(f)} = {escape(v)}" for f, v in preview.inputs) or "—"
    after = f"{code(target)} = <strong>{escape(preview.output)}</strong>" if preview.output is not None \
        else f"<span class='fb-none'>{escape(preview.error or 'No output')}</span>"
    html(f'<table class="fb-kv"><tr><th>Before (dictionary sample)</th><th>After</th></tr><tr><td>{before}</td><td>{after}</td></tr></table>')

    label("Reason for the suggestion")
    origin = {"demo": "Saved Demo-mode proposal", "live_ai": "Live AI proposal", "placeholder": "System placeholder"}[m.origin]
    edited = " Edited by reviewer since it was proposed, so the rationale may be out of date." if m.edited_by_reviewer else ""
    html(f"<div style='font-size:.92rem'>{escape(m.reasoning) or '—'}</div><div class='fb-muted' style='font-size:.8rem'>{origin}.{edited}</div>")

    label("Explicit assumptions")
    assumptions = [(a, "proposal") for a in m.assumptions] + [(a, "transformation registry") for a in (spec.assumptions if spec else ())]
    if assumptions:
        html("<ul style='margin:0;font-size:.9rem'>" + "".join(f"<li>{escape(a)} <span class='fb-muted'>({src})</span></li>" for a, src in assumptions) + "</ul>")
    else:
        html("<div class='fb-muted'>None stated.</div>")


def correction_form(workspace: Workspace, target: str) -> None:
    ctx = workspace.context()
    m = workspace.mapping(target)
    rev = m.revision  # widget keys include the revision so they reset after each applied correction
    st.caption("Choose only from the approved registry and the uploaded dictionary. The outcome updates as you edit.")
    ids = list(REGISTRY)
    transformation = st.selectbox(
        "Transformation (approved registry only)", ids,
        index=ids.index(m.transformation_id) if m.transformation_id in ids else None,
        format_func=lambda t: f"{t} · {REGISTRY[t].label}", key=f"fix_tx_{target}_{rev}",
    )
    spec = REGISTRY.get(transformation) if transformation else None
    names = [f.field_name for f in workspace.dictionary]
    chosen: list[str | None] = []
    for i, role in enumerate(spec.input_roles if spec else ()):
        current = m.source_fields[i] if i < len(m.source_fields) and m.source_fields[i] in names else None
        chosen.append(st.selectbox(
            f"{role} (source field)", names, index=names.index(current) if current else None,
            placeholder="Select a source field",
            format_func=lambda f: f"{f} · {ctx.dictionary[f].data_type} · {ctx.dictionary[f].unit or 'no unit'}",
            key=f"fix_src_{target}_{rev}_{transformation}_{i}",
        ))
    req_ids = [r.id for r in workspace.requirements]
    requirement = st.selectbox(
        "Requirement evidence (quoted exactly from the document)", req_ids,
        index=req_ids.index(m.requirement_id) if m.requirement_id in req_ids else None,
        format_func=lambda r: f"{r}: {ctx.requirements[r].text}", key=f"fix_req_{target}_{rev}",
    )

    complete = transformation is not None and all(chosen)
    unchanged = (transformation == m.transformation_id and list(chosen) == m.source_fields
                 and requirement in (None, m.requirement_id))
    if complete and unchanged:
        st.caption("These are the current settings. Change a field to preview the outcome before applying.")
    elif complete:
        draft = m.model_copy(update={
            "source_fields": [c for c in chosen if c], "transformation_id": transformation,
            "requirement_id": requirement or m.requirement_id,
            "evidence_quote": ctx.requirements[requirement].text if requirement and requirement != m.requirement_id else m.evidence_quote,
            "decision": "Pending", "proposed_status": None,
        })
        draft_ev = evaluate_mapping(draft, ctx)
        outcome = draft_ev.preview.output if draft_ev.preview.output is not None else draft_ev.preview.error
        html(f"<div style='margin:.4rem 0'>If applied: {badge(draft_ev.status)} "
             f"<span class='fb-muted'>&nbsp;Preview → {escape(str(outcome))}</span></div>")
        if draft_ev.status in (BLOCKED, MISSING) and draft_ev.reasons:
            st.caption(draft_ev.reasons[0])
    if st.button("Apply correction", key=f"apply_{target}_{rev}", icon=":material/save:", disabled=not complete):
        changed = correct(workspace, target, [c for c in chosen if c], transformation, requirement)
        flash("toast", f"Updated {target}. Checks re-run." if changed else "No changes to apply.")
        st.rerun()


def step_map() -> None:
    workspace = require_workspace()
    if workspace is None:
        return
    evaluations = workspace.evaluate()
    if st.session_state.selected not in evaluations:
        st.session_state.selected = risk_sorted(workspace, evaluations)[0].target_field

    step_title("Map and review",
               "One proposal per required target field, riskiest first. Open a row to inspect its evidence, "
               "then approve, reject or correct it.")
    counts = {s: sum(1 for e in evaluations.values() if e.status == s) for s in (BLOCKED, MISSING, REVIEW, READY, APPROVED)}
    summary = " ".join(f"{badge(s)} <span class='fb-muted'>×{n}</span>&nbsp;" for s, n in counts.items() if n)
    remaining = len(unresolved(workspace, evaluations))
    bar_l, bar_r = st.columns([4, 1.3], vertical_alignment="center")
    bar_l.markdown(f"<div>{summary}<span class='fb-muted'>· Proposals from {escape(workspace.mapping_source)}</span></div>",
                   unsafe_allow_html=True)
    bar_r.button(f"Review next issue ({remaining})", icon=":material/skip_next:", on_click=review_next,
                 disabled=remaining == 0, width="stretch")

    left, right = st.columns([1.4, 1], gap="medium")
    with left:
        mapping_table(workspace, evaluations)
        st.caption("Statuses come from deterministic rule checks. The AI can ask for review but cannot clear a check or approve a mapping.")
    with right:
        evidence_panel(workspace, evaluations, st.session_state.selected)

    nav_footer(back=1, forward=(3, "Continue to validation"))


# --- Step 3: Validate ------------------------------------------------------------------------------


def rules_table(ev: MappingEvaluation) -> None:
    rows = []
    for c in ev.checks:
        remedy = escape(c.remediation) if c.remediation else "<span class='fb-muted'>—</span>"
        rows.append(
            f"<tr><td>{c.number}</td><td><strong>{escape(c.name)}</strong></td><td>{badge(c.status)}</td>"
            f"<td class='what'>{escape(c.checked)}</td><td>{escape(c.evidence)}</td><td>{remedy}</td></tr>"
        )
    html(
        "<table class='fb-rules'><thead><tr><th>#</th><th>Check</th><th>Status</th><th>What was checked</th>"
        f"<th>Evidence or sample used</th><th>Remediation</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )


def step_validate() -> None:
    workspace = require_workspace()
    if workspace is None:
        return
    evaluations = workspace.evaluate()
    step_title("Validate",
               "Ten deterministic Python checks per mapping, re-run on every change. "
               "The AI does not decide whether a check passes.")
    ordered = risk_sorted(workspace, evaluations)
    tabs = st.tabs([f"{STATUS_ICONS[evaluations[m.target_field].status]} {m.target_field} · {evaluations[m.target_field].status}" for m in ordered])
    for tab, m in zip(tabs, ordered):
        ev = evaluations[m.target_field]
        with tab:
            with st.container(key=f"card_rules_{m.target_field}"):
                tally = {s: sum(1 for c in ev.checks if c.status == s) for s in (BLOCKED, MISSING, REVIEW, READY)}
                html("<div style='margin-bottom:.6rem'>" + " ".join(f"{badge(s)} <span class='fb-muted'>{n} check{'s' if n != 1 else ''}</span>&nbsp;"
                                                                    for s, n in tally.items() if n) + "</div>")
                rules_table(ev)
                if ev.status != APPROVED:
                    st.button("Open in Map and review", key=f"goto_{m.target_field}", icon=":material/edit:",
                              on_click=lambda t=m.target_field: (select(t), go(2)))

    st.write("")
    with st.container(key="card_testplan"):
        html('<div class="fb-card-title">Initial test plan</div>'
             '<div class="fb-muted">Generated from deterministic templates attached to each registered transformation '
             '(transformations.py). The AI does not write these tests.</div>')
        rows = "".join(
            f"<tr><td>T{i}</td><td>{code(r['Target'])}</td><td>{escape(r['Case'])}</td>"
            f"<td>{escape(r['Given'])}</td><td>{escape(r['Expect'])}</td></tr>"
            for i, r in enumerate(build_test_plan(workspace), start=1)
        )
        html("<table class='fb-rules' style='margin-top:.6rem'><thead><tr><th>ID</th><th>Target field</th><th>Case</th>"
             f"<th>Given</th><th>Expect</th></tr></thead><tbody>{rows}</tbody></table>")

    nav_footer(back=2, forward=(4, "Continue to approval and export"))


# --- Step 4: Approve and export ------------------------------------------------------------------------


def toggle_question(question_id: int) -> None:
    set_question_resolved(ws(), question_id, st.session_state[f"q_{question_id}"])


def submit_question() -> None:
    add_question(ws(), st.session_state.get("new_question", ""))
    st.session_state.new_question = ""


def record_export() -> None:
    ws().log("Exported integration brief", new="Markdown brief downloaded")


def step_export() -> None:
    workspace = require_workspace()
    if workspace is None:
        return
    evaluations = workspace.evaluate()
    ready, headline = readiness(workspace, evaluations)
    step_title("Approve and export", "Record final decisions, settle open questions and download the integration brief.")

    if ready:
        html(f'<div class="fb-banner ready" role="status"><h3>✔ Ready for build</h3>{escape(headline)}</div>')
    else:
        html(f'<div class="fb-banner not-ready" role="alert"><h3>⚠ Not ready for build</h3>{escape(headline)} '
             "You can still export the brief. It will be marked NOT READY and list every unresolved item.</div>")

    with st.container(key="card_decisions"):
        html('<div class="fb-card-title">Reviewer decisions</div>')
        widths = [2.2, 2.4, 1.5, 1.4, 0.9, 0.9, 0.9]
        header = st.columns(widths)
        for col, text in zip(header, ["Target field", "Source → transformation", "Status", "Decision", "", "", ""]):
            col.markdown(f'<span class="fb-th">{text}</span>', unsafe_allow_html=True)
        for m in risk_sorted(workspace, evaluations):
            ev = evaluations[m.target_field]
            with st.container(key=f"maprow_{m.target_field}_decision"):
                c = st.columns(widths, vertical_alignment="center")
                c[0].markdown(code(m.target_field), unsafe_allow_html=True)
                sources = ", ".join(m.source_fields) or "no source"
                c[1].markdown(f"<span class='fb-muted'>{escape(sources)} → {escape(m.transformation_id)}</span>", unsafe_allow_html=True)
                c[2].markdown(badge(ev.status), unsafe_allow_html=True)
                c[3].markdown(decision_label(m.decision), unsafe_allow_html=True)
                c[4].button("Approve", key=f"approve4_{m.target_field}", disabled=not can_approve(ev, m),
                            on_click=do_approve, args=(m.target_field,), width="stretch")
                c[5].button("Reject", key=f"reject4_{m.target_field}", disabled=m.decision == "Rejected",
                            on_click=do_reject, args=(m.target_field,), width="stretch")
                c[6].button("Correct", key=f"correct4_{m.target_field}",
                            on_click=lambda t=m.target_field: (select(t), go(2)), width="stretch")

    st.write("")
    left, right = st.columns([1, 1], gap="medium")
    with left:
        with st.container(key="card_questions"):
            html('<div class="fb-card-title">Open questions</div>')
            derived = rule_questions(workspace, evaluations)
            for q in workspace.open_questions:
                st.checkbox(q.text, value=q.resolved, key=f"q_{q.id}", on_change=toggle_question, args=(q.id,))
                st.caption(f"Raised by {q.raised_by}. Tick when answered.")
            for text in derived:
                html(f"<div style='font-size:.92rem;margin:.4rem 0'>{badge(BLOCKED if ' is blocked' in text else MISSING)} {escape(text)}"
                     "<div class='fb-muted' style='font-size:.8rem'>Raised by rule checks. Clears when the finding is fixed.</div></div>")
            if not workspace.open_questions and not derived:
                st.caption("No open questions.")
            q_in, q_btn = st.columns([4, 1], vertical_alignment="bottom")
            q_in.text_input("Add a question for the lender", key="new_question", placeholder="e.g. Is income verified or self-declared?")
            q_btn.button("Add", on_click=submit_question, width="stretch")

    brief = build_brief(workspace, evaluations)
    with right:
        with st.container(key="card_export"):
            html('<div class="fb-card-title">Integration brief</div>'
                 '<div class="fb-muted">Markdown for developers, reviewers and governance stakeholders. It covers mappings, '
                 'formulas, evidence, assumptions, check results, open questions, the test plan and audit history.</div>')
            st.write("")
            st.download_button(
                "Download integration brief (.md)",
                data=brief.encode("utf-8"),
                file_name=f"fieldbridge_brief_northstar_{workspace.created_at:%Y%m%d}.md",
                mime="text/markdown",
                type="primary",
                icon=":material/download:",
                on_click=record_export,
                width="stretch",
            )
            if not ready:
                st.caption("The brief will be marked **NOT READY FOR BUILD**. Unapproved mappings and open questions are listed in full.")
            with st.expander("Preview brief"):
                with st.container(height=460):
                    st.markdown(brief)

    st.write("")
    with st.container(key="card_audit"):
        html('<div class="fb-card-title">Audit history</div><div class="fb-muted">Newest first. Stored in this session only.</div>')
        frame = pd.DataFrame([
            {"Time (UTC)": e.timestamp.strftime("%Y-%m-%d %H:%M:%S"), "Actor": e.actor, "Action": e.action,
             "Target field": e.target_field or "", "Previous value": e.previous_value or "", "New value": e.new_value or ""}
            for e in reversed(workspace.audit)
        ])
        st.dataframe(frame, hide_index=True, width="stretch", height=min(400, 38 + 35 * len(frame)))

    nav_footer(back=3, forward=None)


# --- Navigation ------------------------------------------------------------------------------------------------


def nav_footer(back: int | None, forward: tuple[int, str] | None) -> None:
    st.write("")
    left, _, right = st.columns([1, 3, 1.4])
    if back:
        left.button("Back", icon=":material/arrow_back:", on_click=go, args=(back,), key=f"back_{st.session_state.step}")
    if forward:
        right.button(forward[1], type="primary", icon=":material/arrow_forward:", on_click=go, args=(forward[0],),
                     key=f"fwd_{st.session_state.step}", width="stretch")


def main() -> None:
    init_state()
    st.html(CSS)
    render_sidebar()
    render_header()
    show_flash()
    {1: step_upload, 2: step_map, 3: step_validate, 4: step_export}[st.session_state.step]()


main()
