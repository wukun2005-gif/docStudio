# i-Write, a Document Generation Studio — Product Requirements Document (PRD)

> TRAE AI Creativity Competition · Track 2 (Learning & Work / A New Solution)

---

## 1. Why — Why We Need i-Write

### Problem: Knowledge Fragmentation + Heavy Document Work

Modern knowledge workers' information is scattered across dozens of platforms:

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Knowledge Fragments                    │
│                                                              │
│   📧 Email         💬 Teams Chat      📄 OneDrive Documents  │
│   📊 Excel Tables  🔀 GitHub PR       📑 arXiv Papers        │
│   📋 Meeting Notes  📎 Local PDF       📝 Technical Docs      │
│                                                              │
│              Switching and copy-pasting across 10+ platforms  │
│              every day. Writing a weekly report takes 2 hours │
│              just to organize information.                    │
└─────────────────────────────────────────────────────────────┘
```

Writing a reliable document requires: switching back and forth between multiple platforms → copy-pasting → manual verification → worrying about omissions.

AI can assist with generation, but users **lack trust** in AI-generated content:

```
┌─────────────────────────────────────────────────────────────┐
│              The Trust Crisis in AI-Generated Documents       │
│                                                              │
│   ❓ Was this paragraph made up by AI, or does it have a     │
│      real source?                                             │
│   ❓ Where does this data come from? Which page?              │
│   ❓ Has it been contradicted by subsequent information?      │
│   ❓ What is the quality of this document anyway? Can it be   │
│      sent out directly?                                       │
│                                                              │
│              Users can only judge by eye → afraid to use it   │
└─────────────────────────────────────────────────────────────┘
```

### Limitations of Existing Solutions

```
                    Generation Capability
                           ▲
                           │
             Gamma         │      ChatGPT / Claude
            (Design Gen)   │      (Conversational Gen)
                           │      ✅ Can Generate  ❌ Not Trustworthy
                           │
    ───────────────────────┼──────────────────────► Trustworthiness
                           │
          NotebookLM       │      ★ i-Write
         (Research Assist) │      (Trustworthy Document Gen Workbench)
          ✅ Trustworthy   │      ✅ Can Generate  ✅ Trustworthy
          ❌ Doesn't Generate│     ✅ Multi-Platform  ✅ Evaluation
                           │
```

| Competitor | Can Generate Office Docs? | Can Write Emails? | Fact Provenance? | Cross-Platform Knowledge? | Native Add-in? | Trust Evaluation? | Conflict Detection? | Free? |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| ChatGPT / Claude | ✅ | ✅ | ❌ | File Upload | ❌ | ❌ | ❌ | Partial |
| Google NotebookLM | ❌ | ❌ | Inline Citations | File Upload | ❌ | ❌ | ❌ | Limited |
| Microsoft Copilot | ✅ | ✅ | Within Ecosystem | MS Ecosystem Only | ✅ | ❌ | ❌ | ❌ $30/mo |
| Gamma | PPT Only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Limited |
| **i-Write** | **Word+PPT+Excel** | **✅ Email Draft** | **Paragraph-Level Generation Tree** | **All Platforms** | **4 App Add-in** | **4+6 Metrics** | **✅ Auto Adjudication** | **✅** |

---

## 2. What — What is i-Write

### One-Line Positioning

> **AI-Powered Document Value Workbench** — Let humans focus on the information and story the document conveys; AI generates the document based on your knowledge, and you make judgments, decisions, and trade-offs on the content.

### Core Philosophy

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   Traditional Mode: Humans Write Documents                   │
│   ────────────────────                                       │
│   Collect Info → Organize Materials → Design Structure →     │
│   Choose Words → Format Layout                               │
│   ⏱️ Takes 2-4 hours                                        │
│   😩 Most time spent on "writing" itself, not "thinking"     │
│      about the content                                       │
│                                                              │
│                         ↓ Transformation                     │
│                                                              │
│   i-Write Mode: Humans Review Documents                      │
│   ────────────────────                                       │
│   AI Generates Draft → Human Judges Trade-offs →              │
│   One-Click Finalize                                         │
│   ⏱️ Takes 10-30 minutes                                    │
│   🎯 Humans focus on content value, AI handles formatting,   │
│      layout, and word choice                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### New Human-AI Collaboration Paradigm

```
┌─────────────────────────────────────────────────────────────┐
│                     i-Write Human-AI Collaboration            │
│                                                              │
│   AI Handles (i = AI)              Human Handles             │
│   ────────────────                 ──────────                │
│   • Connect knowledge sources      • Decide what the          │
│   • Retrieve relevant content        document should convey   │
│   • Generate draft                 • Choose which points      │
│   • Build generation tree            matter most              │
│   • Verify factual basis           • Judge info accuracy      │
│   • Format, layout, word choice    • Trade off content        │
│                                      priorities               │
│                                    • Finalize and publish     │
│                                                              │
│         ↓                         ↓                          │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                                                      │   │
│   │        📄 High-Quality Document                      │   │
│   │        Human Judgment + AI Efficiency                │   │
│   │        Deep Content · Quality Expression ·           │   │
│   │        Traceable Sources                             │   │
│   │                                                      │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Six Things "Only i-Write Can Do"

```
 ┌──────────────────────────────────────────────────────────┐
 │  ① Cross-Platform Knowledge Connection                   │
 │     Simultaneously connect local files, OneDrive,        │
 │     GitHub, arXiv, Outlook, Teams;                       │
 │     Email/contacts bidirectional sync, .eml auto-import  │
 │     AI automatically searches your knowledge —           │
 │     no manual organization needed                        │
 ├──────────────────────────────────────────────────────────┤
 │  ② Four App Add-in Native Embedding                      │
 │     Word / Excel / PowerPoint / Outlook sidebar plugins  │
 │     Generate without leaving your office app;            │
 │     results written natively into docs/email/slides      │
 │     Excel inserts native charts, PPT inserts native      │
 │     slides, Outlook writes emails                        │
 ├──────────────────────────────────────────────────────────┤
 │  ③ Quantifiable Trust Decisions                          │
 │     4 user-visible dimensions + 6 underlying metrics    │
 │     Confidence heatmap shows at a glance which           │
 │     paragraphs lack confidence                           │
 │     Conflict detection auto-adjudicates; contradictory   │
 │     content is strictly excluded from documents          │
 ├──────────────────────────────────────────────────────────┤
 │  ④ Debuggable Document Generation                        │
 │     Paragraph-level generation tree + drag-to-regenerate │
 │     (copy/cut modes)                                     │
 │     Give AI a debugger — you control every detail        │
 │     Drag to adjust knowledge source "recipe"; AI         │
 │     regenerates based on the new recipe                  │
 ├──────────────────────────────────────────────────────────┤
 │  ⑤ Chat-Driven Editing + Impact Analysis                 │
 │     Natural language editing of documents; auto-judges   │
 │     change severity level                                │
 │     Minor changes only update trust score; major changes │
 │     auto re-run Groundedness + Conflict Detection        │
 ├──────────────────────────────────────────────────────────┤
 │  ⑥ Offline Evaluation + Model Decision Support           │
 │     Golden Set + Multi-Judge · 10+ Metrics               │
 │     Quantify document quality, compare different LLM     │
 │     configurations, help you choose the right model      │
 └──────────────────────────────────────────────────────────┘
```

### Product Scope

| Priority | Module | Description |
|:---:|------|------|
| P0 | Pre-built Demo Knowledge Base | Project weekly/quarterly report scenario sample data, ready to use (including Q3 report scenario) |
| P0 | Chat Box Interaction | Smart judgment: simple → generate directly, complex → multi-turn follow-up; supports Query Analyzer to separate content points from formatting requirements |
| P0 | Narrative Engine | Outline generation → user adjustment → one-click generation; Query Analyzer intelligently assigns knowledge sources to chapters |
| P0 | RAG Engine | Cross-source retrieval + fusion + reranking + Groundedness verification + Fidelity gating |
| P0 | Document Generation | Export Word / PowerPoint / Excel / Email (email draft) |
| P0 | Generation Tree Visualization | Paragraph-level provenance + drag-to-regenerate + confidence heatmap |
| P0 | Online Evaluation | Real-time trust report (4-dimension quantification) + historical comparison + AI document self-audit (risk radar chart) |
| P0 | Local File Upload | PDF/DOCX/TXT/HTML/Markdown/PPTX/XLSX/EML |
| P0 | Multi-Provider Configuration | User-selectable LLM / Embedding / Reranker (with ModelCapabilities adaptation) |
| P0 | Conflict Detection & Auto-Resolution | High-severity conflicts auto-adjudicated; contradictory content strictly excluded from documents |
| P0 | One-Click Demo | FakeCursor auto-demo + first-visit onboarding (reference GraphMe) |
| P1 | MS OAuth Login | Real Microsoft account login |
| P1 | OneDrive/SharePoint | Auto-fetch + exclusion functionality |
| P1 | GitHub Connector | OAuth login, read code/Issues/PR |
| P1 | arXiv Connector | Search and import papers |
| P1 | Outlook Knowledge Base Sync | Email/contacts bidirectional sync, .eml auto-import, supports email sending |
| P1 | Teams Connector | Read Teams chat history |
| P1 | Offline Evaluation Platform | Golden Set + Multi-Judge + 10+ metrics |
| P1 | Office Add-in (4 apps) | Word / Excel / PowerPoint / Outlook sidebar plugins, native write experience |
| P1 | Chat-Driven Document Editing | Natural language document editing, auto-analyze modification impact scope and re-verify trust score |
| P1 | Prompt Template | Document style/format/audience profile template management and auto-detection |
| P1 | Workflow Engine | Multi-step document generation process definition and auto-execution |
| P2 | html2pptx High-Quality Rendering | Playwright + CSS Flexbox layout → PPTX native charts |
| P2 | Teams Add-in | Teams message extension plugin |
| P2 | More Knowledge Sources | Feishu, WeChat, Xiaohongshu, Zhihu, etc. |
| P2 | More Templates | Business plans, academic reviews, etc. |

---

## 3. User Interaction — User Journey

### 🎬 Happy Journey #1: First Experience (30 Seconds to Start)

The user opens i-Write, no configuration needed, immediately experiences the core value.

```
┌─────────────────────────────────────────────────────────────────────┐
│  i-Write                                    ⚙️ Settings  👤 User   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─── Knowledge Sources ─────┐  ┌─── Document Generation ─────────┐ │
│  │                            │  │                                  │ │
│  │  📂 Pre-built Demo KB      │  │  ┌─ Chat Box ───────────────┐  │ │
│  │  ├─ 📋 Meeting Notes ×5    │  │  │                          │  │ │
│  │  ├─ 📧 Email Threads ×10   │  │  │  Write a weekly project  │  │ │
│  │  ├─ 🔀 Code PRs ×8         │  │  │  progress report for me  │  │ │
│  │  ├─ 💬 Chat Records ×15    │  │  │                          │  │ │
│  │  └─ 📄 Technical Docs ×6   │  │  │                    [Send]│  │ │
│  │                            │  │  └──────────────────────────┘  │ │
│  │  ✅ 44 documents indexed   │  │                                  │ │
│  │                            │  │  ┌─ Generated Outline ───────┐  │ │
│  └────────────────────────────┘  │  │                            │  │ │
│                                   │  │  I. This Week's Goal Review│  │ │
│                                   │  │  II. Completion Status     │  │ │
│                                   │  │  III. Issues & Solutions   │  │ │
│                                   │  │  IV. Next Week's Plan      │  │ │
│                                   │  │  V. Risks & Blockers       │  │ │
│                                   │  │                            │  │ │
│                                   │  │  [✏️ Edit Outline]         │  │ │
│                                   │  │  [▶ One-Click Generate]    │  │ │
│                                   │  └────────────────────────────┘  │ │
│                                   │                                  │ │
│                                   └──────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**User Action**: Type "Write a weekly project progress report for me" → See outline → Click "One-Click Generate"

**System Response**: Smart judgment — requirement is clear → Generate outline directly (no follow-up questions) → Generate document + trust report

---

### 🎬 Happy Journey #2: Viewing the Generation Tree (Core Differentiator)

The user clicks any paragraph in the document to see where this information came from and how trustworthy it is.

```
┌─────────────────────────────────────────────────────────────────────┐
│  i-Write — Generation Result                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─── Generated Document ─────────────────┐  ┌─── Trust Report ────┐ │
│  │                                        │  │                      │ │
│  │  I. This Week's Goal Review            │  │  📊 Overall Trust:   │ │
│  │  This week the team's goal was to      │  │     0.89             │ │
│  │  complete the auth module...           │  │                      │ │
│  │                                        │  │  Groundedness  0.92  │ │
│  │  II. Completion Status                 │  │  Citation Acc.  0.87  │ │
│  │ ┌────────────────────────────────────┐ │  │  Source Cover.  0.95  │ │
│  │ │ ✅ Completed auth module dev this   │ │  │  Coherence      0.91  │ │
│  │ │       ▼ Click to expand gen tree   │ │  │  Completeness   0.85  │ │
│  │ │                                    │ │  │                      │ │
│  │ │  📄 "Completed auth module dev     │ │  │  ┌─ Historical ────┐ │ │
│  │ │  │  this week"                     │ │  │  │   ▲ 0.92        │ │ │
│  │ │  ├── 🔗 Teams Chat (Zhang S 14:30)│ │  │  │   │    ●  0.89  │ │ │
│  │ │  │   Confidence: 0.95             │ │  │  │   │  ●           │ │ │
│  │ │  │   "Auth module integration     │ │  │  │  ●   0.82       │ │ │
│  │ │  │    passed"                      │ │  │  │ ─────────────── │ │ │
│  │ │  │                                │ │  │  │  Last  This     │ │ │
│  │ │  ├── 🔗 GitHub PR #123 (merged)  │ │  │  └─────────────────┘ │ │
│  │ │  │   Confidence: 0.98             │ │  │                      │ │
│  │ │  │   "feat: add OAuth2 flow"      │ │  │  [📊 Version Compare]│ │
│  │ │  │                                │ │  │  [📥 Download .docx] │ │
│  │ │  └── 🔗 Meeting Notes (Mon standup)│ │  │  [📤 Push to Word]  │ │
│  │ │      Confidence: 0.82             │ │  │                      │ │
│  │ │      "Goal: Complete auth module" │ │  └──────────────────────┘ │
│  │ └────────────────────────────────────┘ │                          │
│  │                                        │                          │
│  └────────────────────────────────────────┘                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**User Action**: Click paragraph → See generation tree (3 sources + confidence scores) → See trust report

**Key Experience**: Users can see at a glance "where this sentence came from, how trustworthy it is, and whether it can be sent out directly"

---

### 🎬 Happy Journey #3: Drag-to-Regenerate (Precise Control)

The user is unsatisfied with the source of a paragraph and drags a new source to update it.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Drag-to-Regenerate Workflow                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: User sees an email source in the generation tree, wants   │
│          to replace the meeting notes with it                       │
│                                                                     │
│    Gen Tree:                      Document Paragraph:               │
│    ┌─────────────────┐            ┌─────────────────────────┐      │
│    │ 🔗 Teams Chat    │            │                         │      │
│    │ 🔗 GitHub PR     │            │  "Completed auth module │      │
│    │ 📧 Email (Drag!) ─┼─── ✂️ ───┼─→   dev this week"      │      │
│    │ 🔗 Meeting Notes  │            │                         │      │
│    └─────────────────┘            └─────────────────────────┘      │
│                                                                     │
│  Step 2: Choose "cut" (replace citation) or "copy" (add citation)  │
│                                                                     │
│  Step 3: System precisely regenerates that paragraph (others        │
│          remain unchanged)                                          │
│                                                                     │
│    ┌─────────────────────────────────────────────────────┐         │
│    │ ✅ Paragraph Updated                                 │         │
│    │                                                      │         │
│    │  "Completed auth module dev this week.               │         │
│    │   Per Zhang San's email confirmation, integration    │         │
│    │   testing was passed on Tuesday afternoon."          │         │
│    │                                                      │         │
│    │  📊 Trust: 0.82 → 0.91 (↑ new source more reliable)│         │
│    └─────────────────────────────────────────────────────┘         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 🎬 Happy Journey #4: Connecting Real Data

The user upgrades from the Demo experience to using their own real knowledge sources.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Connect Knowledge Source Workflow                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─── Connect Knowledge Sources ────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌─────────────────────────────────────────────────────┐    │  │
│  │  │  🟢 Microsoft Account                  [Connected ✓] │    │  │
│  │  │     Auto-fetch: OneDrive · SharePoint · Teams · Outlook│   │  │
│  │  │     Indexed: 127 docs · Excluded 3 folders            │    │  │
│  │  └─────────────────────────────────────────────────────┘    │  │
│  │                                                              │  │
│  │  ┌─────────────────────────────────────────────────────┐    │  │
│  │  │  🟢 GitHub                        [Connected ✓]     │    │  │
│  │  │     Selected: myorg/frontend, myorg/backend          │    │  │
│  │  │     Indexed: 45 PRs · 120 Issues                     │    │  │
│  │  └─────────────────────────────────────────────────────┘    │  │
│  │                                                              │  │
│  │  ┌─────────────────────────────────────────────────────┐    │  │
│  │  │  📁 Local Files                    [Upload Files]    │    │  │
│  │  │     Uploaded: 8 files (PDF/DOCX/TXT)                 │    │  │
│  │  └─────────────────────────────────────────────────────┘    │  │
│  │                                                              │  │
│  │  ┌─────────────────────────────────────────────────────┐    │  │
│  │  │  🔬 arXiv Papers                  [Search & Import]  │    │  │
│  │  │     Imported: 5 papers                               │    │  │
│  │  └─────────────────────────────────────────────────────┘    │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 🎬 Happy Journey #5: Office Add-in (Cross-App Generation)

The user invokes the i-Write add-in in Excel Online, **not only based on the Excel content but also other knowledge sources (PRD, design docs, GitHub)**, to generate a project progress PPT and Excel charts.

**Core Feature: Generate Across Apps Without Leaving Excel**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Excel Online — i-Write Add-in                                      │
├────────────────────────────────────────────────┬────────────────────┤
│                                                │                    │
│  ┌─ Excel Worksheet ─────────────────────┐    │  i-Write           │
│  │                                       │    │  ─────────────    │
│  │  Project  │ Status   │ Progress│ Owner│    │                    │
│  │  ─────────┼──────────┼─────────┼───── │    │  ┌─ Chat Box ──┐ │
│  │  Auth     │ ✅ Done   │ 100%   │ Zhang│    │  │             │ │
│  │  Payment  │ 🔄 In Prog│ 60%   │ Li   │    │  │ Based on    │ │
│  │  Search   │ ⚠️ Blocked│ 30%   │ Wang │    │  │ this Excel  │ │
│  │  Data Mig │ ✅ Done   │ 100%   │ Zhao │    │  │ and other   │ │
│  │                                       │    │  │ docs,       │ │
│  └───────────────────────────────────────┘    │  │ generate    │ │
│                                                │  │ project     │ │
│  ┌─ Connected Knowledge Sources ───────┐    │  │ progress    │ │
│  │  📄 PRD Document (OneDrive)          │    │  │ report      │ │
│  │  📄 Design Doc (OneDrive)            │    │  │       [Send]│ │
│  │  🔀 GitHub commits (last 1 week)     │    │  └─────────────┘ │
│  │  📊 Project Tracker (OneDrive)       │    │                    │
│  │  📧 Email Threads (Outlook)          │    │  ┌─ Results ────┐ │
│  └───────────────────────────────────────┘    │  │             │ │
│                                                │  │ ✅ PPT gen'd │ │
│                                                │  │ ✅ Excel charts│
│                                                │  │ ✅ Weekly email│
│                                                │  │             │ │
│                                                │  │ 📊 Trust:   │ │
│                                                │  │    0.87     │ │
│                                                │  │             │ │
│                                                │  │ [Open PPT]  │ │
│                                                │  │ [View Charts]│ │
│                                                │  │ [View Gen Tree]│
│                                                │  └─────────────┘ │
│                                                │                    │
└────────────────────────────────────────────────┴────────────────────┘

Results (without leaving Excel):
1. Project Progress PPT → Auto-saved to OneDrive
2. Excel Charts → Inserted into current worksheet
3. Project Weekly Email → Saved to Outlook Drafts
```

---

### 🎬 Happy Journey #6: Offline Evaluation (LLM Model Decision Support)

The user switched their LLM provider and wants to see if the new configuration produces better quality.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Evaluation Dashboard                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─── LLM Configuration ─────────────────────────────────────────┐ │
│  │  Current: MiMo (mimo-v2.5)    [Switch ▼]                      │ │
│  │  Embedding: SiliconFlow/bge-m3  [Switch ▼]                     │ │
│  │  Reranker: bge-reranker-base    [Switch ▼]                     │ │
│  │                                                                 │ │
│  │                    [▶ Evaluate Current Config]                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─── Evaluation Result Comparison ───────────────────────────────┐ │
│  │                                                                 │ │
│  │  Metric          │  Last (Gemini)  │  This (MiMo)  │  Change   │ │
│  │  ────────────────┼─────────────────┼───────────────┼──────────  │ │
│  │  Faithfulness    │     0.82        │     0.91      │  ↑ +9%    │ │
│  │  Coherence       │     0.88        │     0.85      │  ↓ -3%    │ │
│  │  Citation Prec.  │     0.79        │     0.93      │  ↑ +14%   │ │
│  │  Completeness    │     0.85        │     0.87      │  ↑ +2%    │ │
│  │  Fluency         │     0.90        │     0.86      │  ↓ -4%    │ │
│  │                                                                 │ │
│  │  💡 Recommendation: MiMo shows significant improvement in      │ │
│  │     Faithfulness and Citation, but slight decline in            │ │
│  │     Coherence and Fluency. MiMo is recommended.                │ │
│  │                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─── History ────────────────────────────────────────────────────┐ │
│  │  📅 2026-06-22 14:30  MiMo    Faithfulness: 0.91  [View]      │ │
│  │  📅 2026-06-21 10:15  Gemini  Faithfulness: 0.82  [View]      │ │
│  │  📅 2026-06-20 16:45  MiMo    Faithfulness: 0.89  [View]      │ │
│  │                                                                 │ │
│  │  [📊 Trend Chart]  [🔀 Version Comparison]                     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Success Metrics

### User Value Metrics

| Metric | Target | Measurement |
|------|------|---------|
| Document Generation Time | 5x+ faster than manual writing | Time from user input to document delivery |
| Trust Score | Groundedness ≥ 0.85 | Online evaluation after each generation |
| User Satisfaction | ≥ 4.0 / 5.0 | Proportion of documents that can be sent directly |
| Knowledge Source Utilization | ≥ 80% | Proportion of connected knowledge sources actually cited |

### Product Quality Metrics

| Metric | Target | Description |
|------|------|------|
| Groundedness | ≥ 0.85 | Proportion of generated content with factual basis |
| Citation Accuracy | ≥ 0.90 | Proportion of citations correctly pointing to sources |
| Coherence | ≥ 0.85 | Document logical coherence |
| Completeness | ≥ 0.80 | Coverage of outline requirements |
| Source Coverage | ≥ 0.80 | Degree to which knowledge sources are fully utilized |

### Offline Evaluation Metrics (LLM Model Decision Support)

| Dimension | Metric | Description |
|------|------|------|
| Retrieval Quality | NDCG@K, Recall@K | Retrieval result ranking and coverage |
| Factual Accuracy | Faithfulness, Groundedness | Whether generated content is faithful to sources |
| Citation Quality | Citation Precision, Citation Recall | Whether citations are correct and complete |
| Document Quality | Coherence, Fluency, Completeness | Quality of the document as written text |
| End-to-End | Answer Correctness, Fact Coverage | Comparison with Golden Set |

### Long-term Value of Evaluation Data

The greatest value of accumulated evaluation data (50+ generations) is **document type adaptation analysis**:

```
┌─────────────────────────────────────────────────────────────┐
│  Evaluation Insights                                         │
│                                                              │
│  📊 Document Type Quality Analysis                           │
│  ────────────────────                                        │
│  Weekly Report: Faithfulness 0.91  Coherence 0.88  ✅ High   │
│  Research Report: Faithfulness 0.72  Coherence 0.79          │
│                   ⚠️ Needs Optimization                      │
│  PPT Outline: Faithfulness 0.85  Coherence 0.82  ✅ Medium   │
│                                                              │
│  💡 Recommendation: Your "Research Report" template quality  │
│  is low. Suggested:                                          │
│  1. Add more arXiv papers as knowledge sources               │
│  2. Adjust outline structure, add "Methodology" section      │
│  3. Try switching LLM provider (Current: MiMo,              │
│     Suggested: GPT-4o)                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

This helps users:
- Discover which document types generate well and which need optimization
- Targetedly adjust templates, knowledge sources, or providers
- Continuously optimize generation quality as usage grows

---

## 5. High-level Solution

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        i-Write Overview                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────── Knowledge Source Connectors ────────────────────┐ │
│  │                                                                │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │ │
│  │  │OneDrive │ │ GitHub  │ │  arXiv  │ │  Local  │ │Outlook │ │ │
│  │  │SharePoint│ │         │ │ Papers  │ │Files    │ │ Email  │ │ │
│  │  │         │ │         │ │         │ │PDF/DOCX │ │        │ │ │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │ │
│  │  ┌─────────┐ ┌─────────┐                                │     │ │
│  │  │ Teams   │ │Contacts │                                │     │ │
│  │  │  Chat   │ │(Outlook)│                                │     │ │
│  │  └────┬────┘ └────┬────┘                                │     │ │
│  │       └───────────┴───────────┴───────────┴───────────┘     │ │
│  │                          │                                    │ │
│  └──────────────────────────┼────────────────────────────────────┘ │
│                             ▼                                       │
│  ┌─────────────── Knowledge Base (SQLite + Vector Index) ─────────┐ │
│  │                                                                │ │
│  │  📄 Doc Chunking → 🔢 Vectorization → 📊 BM25 Index →         │ │
│  │  🔍 Hybrid Retrieval                                          │ │
│  │                                                                │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             ▼                                       │
│  ┌─────────────── Narrative Engine ───────────────────────────────┐ │
│  │                                                                │ │
│  │  💬 Chat Box → 📋 Outline Gen → ✏️ User Adjust →              │ │
│  │  ▶ One-Click Generate (RAG+LLM)                               │ │
│  │  (Smart Judgment) (Template+Custom) (Drag/Edit)               │ │
│  │                                                                │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             ▼                                       │
│  ┌─────────────── Generation + Trust Layer ───────────────────────┐ │
│  │                                                                │ │
│  │  📄 Doc Generation       🌳 Generation Tree    📊 Trust Report │ │
│  │  Word/PPT/Excel          Paragraph-level       Groundedness   │ │
│  │  Online editing          provenance            Citation Acc.  │ │
│  │                          Drag-to-regenerate    Historical     │ │
│  │                          Confidence scoring    trends         │ │
│  │                                              Version compare  │ │
│  │                                                                │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             ▼                                       │
│  ┌─────────────── Offline Evaluation Platform ────────────────────┐ │
│  │                                                                │ │
│  │  🎯 Golden Set → 👥 Multi-Judge → 📈 10+ Metrics Report       │ │
│  │  (Auto-generate)   (2 LLMs judge       (Supports LLM model   │ │
│  │                     independently)      decision-making)       │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─────────────── Output Layer ───────────────────────────────────┐ │
│  │                                                                │ │
│  │  🌐 Web App Direct Generation  │  📎 Office Add-in Sidebar    │ │
│  │  .docx / .pptx / .xlsx         │  Word / Excel / PPT /        │ │
│  │  .eml Email Draft              │  Outlook                     │ │
│  │                                │  Native write to             │ │
│  │                                │  docs/sheets/slides/email    │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Data Flow

```
User Request: "Write a weekly project progress report for me"
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  ① Narrative Engine: Understand Request → Generate Outline   │
│     → User Confirm                                          │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ② RAG Retrieval: Outline per Chapter → Query Expansion →   │
│     Hybrid Retrieval → RRF Fusion → Reranker Re-ranking →  │
│     Top-K Sources                                           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ③ LLM Generation: Retrieved Results + Chapter Instructions │
│     → LLM Generates Paragraphs with Citations              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ④ Groundedness Verification: Each Sentence → Source Support │
│     → groundedRatio >= 0.8 → pass                           │
│     → groundedRatio < 0.5 → Trigger Re-generation          │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ⑤ Generation Tree Construction: Each Paragraph →           │
│     Link to Source Documents + Confidence Scores            │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ⑥ Output: Word Document + Generation Tree + Trust Report   │
└─────────────────────────────────────────────────────────────┘
```

### Technical Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ Frontend (React + TypeScript + Vite) ─────────────────────────┐ │
│  │                                                                │ │
│  │  Chat Box │ Outline Editor │ Doc Viewer │ Gen Tree Viz │ Eval  │ │
│  │                                                                │ │
│  └─────────────────────────────┬──────────────────────────────────┘ │
│                                │ HTTP API                           │
│  ┌─ Backend (Express + Node.js) ─────────────────────────────────┐ │
│  │                                                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │ │
│  │  │ Narrative│ │   RAG    │ │   Eval   │ │ Knowledge Source  │ │ │
│  │  │  Engine  │ │  Engine  │ │  Engine  │ │   Connectors     │ │ │
│  │  │          │ │          │ │          │ │ MS Graph/GitHub  │ │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │ │
│  │                                                                │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │  SQLite (Knowledge Base + Eval Data + User Config)       │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Office Add-in (Office.js) ───────────────────────────────────┐ │
│  │                                                                │ │
│  │  Word Sidebar │ Excel Sidebar │ PowerPoint Sidebar │ Outlook   │ │
│  │  (Share same backend API, native write to each app)            │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ External APIs (User-Selected Provider) ───────────────────────┐ │
│  │                                                                │ │
│  │  LLM API │ Embedding API │ Reranker API │ MS Graph API        │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Deployment & Privacy

```
┌─────────────────────────────────────────────────────────────────────┐
│  Data Flow & Privacy                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User's Document Content                                            │
│      │                                                              │
│      ├─→ i-Write Backend ──→ Chunking, BM25 Index (Local Process)  │
│      │                                                              │
│      ├─→ Embedding API (Remote) ──→ Vectorization                  │
│      │     (User-selected provider: SiliconFlow / OpenAI / ...)     │
│      │                                                              │
│      ├─→ Reranker API (Remote) ──→ Re-ranking                      │
│      │     (User-selected provider)                                 │
│      │                                                              │
│      └─→ LLM API (Remote) ──→ Generate Document                    │
│            (User-selected provider: MiMo / OpenAI / DeepSeek / ...) │
│                                                                     │
│  🔒 i-Write itself does not store user document content             │
│  🔒 Privacy determined by user-selected provider                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Product Decisions

All decisions have been thoroughly discussed and confirmed:

| # | Decision Item | Choice | Notes |
|---|--------|------|------|
| 1 | Demo Scenario | Project Weekly/Report | Simulate a team leader writing a weekly report |
| 2 | Office Add-in | Real, functional Add-in | Sideload to Office Online |
| 3 | Evaluation System | Comprehensive metrics | 10+ metrics + Golden Set + Multi-Judge |
| 4 | UI Language | Chinese | Targeting domestic users and competition |
| 5 | Login Flow | Real MS OAuth | Actual OAuth flow |
| 6 | Knowledge Sources | All | Local + OneDrive + GitHub + arXiv + Office |
| 7 | Output Formats | Word + PPT + Excel | .docx / .pptx / .xlsx |
| 8 | Generation Tree Interaction | Paragraph-level + Drag-to-regenerate | Drag nodes to precisely regenerate paragraphs |
| 9 | One-Click Demo | After MVP acceptance | **Reference GraphMe project's FakeCursor feature**: Top-right ▶ button triggers auto-demo, first visit auto-enters onboarding flow |
| 10 | First Experience | Pre-built Demo + Chat Box | Zero-config immediate experience |
| 11 | Narrative Templates | Templates + Full Customization | Both available |
| 12 | Golden Set | Supports LLM model decisions | Offline evaluation comparing different configurations |
| 13 | User-side Evaluation | Real-time trust + Historical comparison | Time trends + Version comparison |
| 14 | Chat Interaction | Smart judgment | Simple → direct, Complex → follow-up |
| 15 | Web + Add-in | Shared backend | Data interoperable |
| 16 | Generation Flow | Outline adjust → One-Click generate | Confirm outline first, then generate |
| 17 | Historical Comparison | Time trends + Version comparison | Both needed |
| 18 | MS Content | Auto-fetch + Exclusion | Auto-retrieve, user can exclude |
| 19 | Document Editing | Online editing supported | Trust auto-updates after edits |
| 20 | Knowledge Source Conflicts | Keep both sources | On one hand... on the other hand... |
| 21 | User Feedback | No feedback collection | Judge via metrics only |
| 22 | Deployment | Simplest approach | Privacy determined by provider |
| 23 | Eval Report Interaction | Guided optimization | Low-score paragraphs guide user to one-click optimize, not just show scores |
| 24 | Knowledge Source Priority | System auto | Determined by cross-source fusion reranking, not exposed to user |
| 25 | Iterative Generation | Reuse based on history | User can one-click generate new document based on last config, maintaining consistent formatting |
| 26 | Generation Tree CRUD | Full operations | Delete source, adjust priority, manually add source, replace source |
| 27 | Historical Docs into KB | Auto | User-confirmed saved generated docs auto-become new knowledge sources |
| 28 | Proactive Generation | Action Item triggered | Extract Action Items from Teams meeting notes, auto-collect related knowledge sources, proactively generate corresponding documents |
| 29 | Template Saving | Supported | User can save historical generation configs as templates, reusing outline + source assignment + style |
| 30 | Template Sharing | Backlog | Not in this phase, future team template sharing |
| 31 | Batch Generation | Backlog | Not in this phase, future multi-document generation |
| 32 | Version Management | No | No file manager, only keep evaluation records |
| 33 | History Search | Basic | Basic search available, but not core product feature |
| 34 | Workflow | Supported | User can define multi-step document generation processes, auto-generate related docs per fixed business processes |
| 35 | Proactive Trigger Conditions | User-configurable | User can set trigger conditions, defaults apply if not set (meeting ends, periodic report due, etc.) |
| 36 | Writing Style Learning | Adaptive | User's writing style as knowledge auto-updated into knowledge base |
| 37 | Multi-language | Chinese & English primarily | System auto-detects language, other languages not supported for now |
| 38 | User Feedback | Backlog | Not now, future feedback signal for improvement |
| 39 | People Graph | Supported | Org chart + interpersonal relationship graph, as high-weight signal influencing doc generation style and content depth |
| 40 | Knowledge Source Types | Online first | Knowledge sources must access online and local documents, especially online documents |
| 41 | Cross-App Generation | Supported | Office Add-in generates docs not only from current app content but also other knowledge sources |
| 42 | Generated Output Location | Flexible | Generated docs can be local or online, prefer saving to OneDrive |
| 43 | Sample Data | Required | Pre-generate and prepare for demos and automated testing |

---

## 7. Demo Scenario Design

### Scenario: Project Weekly Report / Presentation

Simulate a team leader ("Zhang San")'s week of work:

| Time | Event | Knowledge Source |
|------|------|--------|
| Monday | Define weekly goals: complete auth module, fix 3 high-priority bugs | Meeting Notes |
| Tuesday | Technical challenge during development, team discusses solutions | Teams Chat + Email |
| Wednesday | Design review passed, start integration | Meeting Notes + GitHub PR |
| Thursday | Auth module integration passed, new issues discovered | GitHub PR + Teams |
| Friday | Most goals completed, prepare weekly report | All sources |

### Sample Data Inventory

> All sample data must be pre-generated and ready for demos and automated testing.

#### Purpose

Provide high-quality synthetic sample data for the i-Write document generation application, used for:
- **Knowledge Base**: After user upload, can be effectively recalled by RAG retrieval engine
- **People Graph**: Org chart and interpersonal relationship graph
- **Demo Showcase**: Demonstrate product capabilities during first experience

#### Data Specifications

| Type | Quantity | Format | Description |
|------|------|------|------|
| Meeting Notes | 8 | .docx | Monday standup ~ Friday Retro + special reviews |
| Technical Docs | 10 | .docx | Architecture design, API docs, technical specs, etc. |
| Emails | 15 | .eml | Internal team communication, client emails |
| Teams Chat | 1 | .json | Dev team daily discussions |
| Excel Data | 4 | .xlsx | Project progress, bug stats, client feedback, etc. |
| PPT Presentations | 3 | .pptx | Product roadmap, investor updates, project weekly |
| Org Chart | 1 | .json | 18 people, 7 departments, 26 relationships |
| **Total** | **42** | | |

#### Content Quality Requirements

| Dimension | Requirement | Description |
|------|------|------|
| Document Length | Long docs 3000-5000 chars | Ensure chunker produces >= 2 chunks |
| Person Names | Real Chinese names, no "Zhang San Li Si" | Consistent with People Graph personnel |
| Text-to-Graphic Ratio | Word contains tables, PPT contains charts | Enhance visual richness |
| Structural Completeness | Meeting notes have action items, technical docs have sections | Conform to document type templates |

#### Personnel Data

- **Company**: Nexora Tech
- **Headcount**: 18-19 people
- **Departments**: Management, Engineering, Product, Design, Marketing, Sales, Customer Success, Legal
- **Email**: Unified @nexora-tech.com domain
- **Relationships**: 26 (reporting, collaboration, cross-team)

#### Acceptance Criteria (E2E Testing)

Sample data must pass full-chain E2E testing (`node tests/e2e-sample-data.mjs`), covering:

**Knowledge Base Chain**:
- File Upload: All 41 files uploaded successfully
- Chunk Generation: Total chunks > 41, long docs >= 2 chunks
- Type Coverage: 5 types (docx, email, json, excel, ppt) all covered
- Search Recall: Queries on document topics hit corresponding docs (hit rate >= 80%)
- SourceId Traceability: Search results contain chunk.sourceId

**People Graph Chain**:
- JSON Import: Supports { nodes, edges } format, import successful
- Person Count: >= 15 people
- Department Count: >= 5 departments
- CRUD Operations: Add, query, update, delete all working
- Relationship Query: Single-person relationship query returns >= 1 result

**Document Generation Chain**:
- RAG Retrieval: Knowledge base search triggered during generation
- Citation Generation: Generated content contains [N] citation markers
- Source Filenames: Citations link to original KB files (not UUIDs)

#### Evaluation Metrics

**RAG Pipeline Metrics (RAGAS Framework)**:

| Metric | Definition | Production Threshold |
|------|------|---------|
| Faithfulness | Proportion of generated claims supported by retrieved context | >= 0.70 |
| Answer Relevancy | Relevance of generated content to original query | >= 0.70 |
| Context Precision | Retriever's ability to rank relevant documents higher | >= 0.60 |
| Context Recall | Whether retriever found all needed information | >= 0.70 |

**Synthetic Data Quality Metrics**:

| Metric | Definition | Threshold |
|------|------|------|
| Self-BLEU | Inter-document similarity (lower = more diverse) | < 0.50 |
| Uniqueness | Proportion of non-near-duplicate documents | >= 0.90 |
| Type Coverage | Target document type coverage rate | 100% |
| Structural Conformance | Proportion of documents conforming to their type template | >= 80% |
| Fluency | Language fluency (LLM-scored) | >= 3.5/5 |

**Success Definition**:

For a document generation application, "qualitative sample data" must satisfy:
1. Functional chain works — upload → chunk → search → generate → citation full chain without errors
2. Chunk quality — each document produces >= 2 chunks (long docs >= 5 chunks)
3. Search recallable — queries on document topics hit corresponding documents
4. Citations linkable — citations in generated documents trace back to original KB files
5. Data diversity — 6 file types fully covered, no near-duplicate documents
6. Personnel data complete — 18-person org chart fully imported, CRUD working

### Demo Flow (5 Acts)

```
Act 1: Product Introduction Generation (30s)
  ──────────────────────────────────────
  Input: "Generate a product introduction PPT"
  Knowledge Sources: PRD doc + Design doc + GitHub commits
  Output: Product intro PPT (auto-saved to OneDrive)
  Showcase: Open OneDrive → See the generated PPT

Act 2: Project Progress Report (30s)
  ──────────────────────────────────────
  Input: "Generate this week's project progress report"
  Knowledge Sources: Excel tracker + Project docs + Meeting notes + GitHub commits
  Output: Project progress PPT + Weekly report email
  Showcase: Open OneDrive → See PPT; Open Outlook → See email draft

Act 3: Generation Tree Provenance (30s)
  ──────────────────────────────────────
  Click paragraph in PPT → Expand generation tree
  See: PRD page 5 + Design doc chapter 3 + GitHub PR #123
  Drag new source → Paragraph precisely regenerated

Act 4: Cross-App Generation (30s)
  ──────────────────────────────────────
  Open i-Write add-in in Excel
  Input: "Based on this Excel and related docs, generate a project progress PPT"
  Knowledge Sources: Current Excel + PRD + Design doc + GitHub
  Output: PPT directly written to PowerPoint Online
  Showcase: Without leaving Excel, PPT is generated

Act 5: Offline Evaluation (30s)
  ──────────────────────────────────────
  Open evaluation dashboard → Evaluate current config
  Switch LLM provider → Evaluate again
  Comparison: "New config shows +12% in Faithfulness"
```

### One-Click Demo (Reference GraphMe)

**Reference Project**: GraphMe (/Users/wukun/Documents/tmp/GraphMe)

**Feature Description**:
- Top-right ▶ button, click to trigger auto-demo mode
- First visit auto-enters 4-step onboarding flow
- Auto-demos the complete Demo flow (5 acts × 30 seconds)
- User can interrupt or skip at any time

**Implementation Requirements**:
1. **FakeCursor Auto-Demo**: Simulate user actions, auto-execute complete Demo flow
2. **First-Time Onboarding**: New users auto-enter onboarding mode on first visit
3. **Interruptible**: User can click anywhere to interrupt auto-demo
4. **Progress Indicator**: Show current demo progress (which act / total acts)
5. **Repeatable**: User can click ▶ at any time to re-trigger demo

**Interaction Flow**:
```
User clicks ▶ → Start auto-demo
  → Act 1: Product Introduction Generation (auto-input, auto-click, auto-showcase)
  → Act 2: Project Progress Report
  → Act 3: Generation Tree Provenance
  → Act 4: Cross-App Generation
  → Act 5: Offline Evaluation
  → Demo complete, show "Log in to experience full features"
```

---

## 8. Complete Feature List

### P0 — Must Implement

#### 8.1 Knowledge Source Management

| # | Feature | Description |
|---|------|------|
| 1 | Pre-built Demo Knowledge Base | Project weekly report scenario sample data, ready to use |
| 2 | Local File Upload | Drag-and-drop upload PDF/DOCX/TXT/HTML/Markdown, auto-parse, chunk, and index |
| 3 | Historical Docs into KB | User-confirmed saved generated docs auto-become new knowledge sources |
| 4 | People Graph | Org chart + interpersonal relationship graph, as high-weight signal influencing doc generation style and content depth |

#### 8.2 Narrative Engine

| # | Feature | Description |
|---|------|------|
| 5 | Chat Box Interaction | Smart judgment of request complexity, direct generation or multi-turn follow-up; supports Rich UI Elements to guide requirement clarification |
| 6 | Outline Generation & Adjustment | Generate outline based on user request, supports drag-to-reorder, add/delete/rename chapters |
| 7 | Narrative Templates | 3-5 fixed templates + full user customization |
| 8 | One-Click Generate | One-click generate complete document after confirming outline |

#### 8.3 RAG Engine

> Reference patentExaminator project implementation, core algorithms and parameter configs directly reused.

| # | Feature | Description |
|---|------|------|
| 9 | Query Expansion | Cross-language expansion + synonym expansion + Multi-Query rewriting |
| 10 | Query Analyzer | LLM-driven separation of content points from formatting requirements; assigns points to specific chapters to prevent formatting instructions from polluting retrieval |
| 11 | Hybrid Search | BM25 keyword search + vector semantic search + RRF fusion + MMR diversity ranking |
| 12 | Reranker | Three-tier fallback: Remote API → Local Cross-Encoder → Heuristic weighting |
| 13 | Fidelity Check | Pre-generation gating: filters out irrelevant retrieved docs vs. chapter topic, ensuring quality from the source |
| 14 | Groundedness Check | Sentence-level verification, groundedRatio >= 0.8 pass, < 0.5 triggers re-generation |
| 15 | Conflict Detection + Auto-Resolution | Cross-source contradiction identification; high-severity conflicts auto-adjudicated by authority + time; losing content excluded |

**RAG Pipeline Parameters (Reference patentExaminator)**

| Parameter | Default | Description |
|------|--------|------|
| chunk_size | 512 | Document chunk size (tokens) |
| chunk_overlap | 64 | Chunk overlap size |
| embedding_model | User-configured | Default SiliconFlow/bge-m3 |
| embedding_dimension | 1024 | Vector dimension |
| bm25_k1 | 1.2 | BM25 parameter k1 |
| bm25_b | 0.75 | BM25 parameter b |
| rrf_k | 60 | RRF fusion parameter |
| mmr_lambda | 0.7 | MMR diversity parameter |
| top_k | 10 | Retrieval return count |
| reranker_top_k | 5 | Post-reranking return count |
| groundedness_threshold | 0.8 | Groundedness pass threshold |
| groundedness_fail_threshold | 0.5 | Groundedness failure threshold (triggers re-generation) |

#### 8.4 Document Generation

| # | Feature | Description |
|---|------|------|
| 13 | Word Generation | Generate .docx files with headings, paragraphs, citations, styles, tables |
| 14 | PowerPoint Generation | Generate .pptx files (PptxGenJS) with title slides, content slides, native charts; supports html2pptx high-quality rendering (Playwright + CSS Flexbox) |
| 15 | Excel Generation | Generate .xlsx files with data tables, native Office charts (6 types), HYPERLINK references |
| 16 | Email Draft Generation | Generate Outlook-friendly HTML email with inline styles, footnote citations, auto XSS cleanup; supports setAsync direct write to email body |
| 17 | Online Editing | User edits generated documents directly in the app; Chat-driven editing auto-analyzes impact scope and re-verifies trust score |

#### 8.5 Generation Tree

| # | Feature | Description |
|---|------|------|
| 17 | Generation Tree Visualization | Paragraph-level generation tree + confidence scoring |
| 18 | Generation Tree CRUD | Delete source, adjust source priority, manually add source, replace source (copy/cut) |
| 19 | Drag-to-Regenerate | Drag generation tree node to precisely regenerate specified paragraph, other paragraphs unchanged |

#### 8.6 Evaluation System

| # | Feature | Description |
|---|------|------|
| 20 | Online Evaluation | Real-time trust report (5 core metrics) |
| 21 | Eval Report Guided Optimization | Low-score paragraphs guide user to one-click optimize |
| 22 | Historical Comparison | Time trend chart + Version side-by-side comparison |
| 23 | Evaluation Data Insights | Analyze quality trends by document type, guide user template optimization |

#### 8.7 Configuration & History

| # | Feature | Description |
|---|------|------|
| 24 | Multi-Provider Configuration | User configures their own LLM / embedding / reranker provider |
| 25 | Iterative Generation | One-click generate new doc based on historical config reuse |
| 26 | Template Saving | User can save historical generation configs as templates |
| 27 | Demo Mode | No token consumption, pre-built sample data (reference GraphMe) |

### P1 — Should Implement

#### 8.8 Knowledge Source Connectors

| # | Feature | Description |
|---|------|------|
| 28 | MS OAuth Login | Real Microsoft account login |
| 29 | OneDrive/SharePoint Connector | Auto-fetch user Office docs + exclusion functionality |
| 30 | GitHub Connector | OAuth login, read repo code/Issues/PR |
| 31 | arXiv Connector | Public API search and import papers |
| 32 | Outlook Connector | Read email content as knowledge source |
| 33 | Teams Connector | Read Teams chat history |

#### 8.9 Office Add-in (4 Apps)

| # | Feature | Description |
|---|------|------|
| 34 | Word Add-in | Sidebar integration, read current document context, generate content natively written to Word |
| 35 | Excel Add-in | Read worksheet usedRange/selectedRange, generate sheet with native tables and charts, charts anchored to cells |
| 36 | PowerPoint Add-in | Read slide text, PptxGenJS generates PPTX, insertSlidesFromBase64 natively inserts slides |
| 37 | Outlook Add-in | Read email context (subject/sender/body), setAsync direct write to email body in Compose mode, read-only protection in Read mode |

#### 8.10 Offline Evaluation Platform

| # | Feature | Description |
|---|------|------|
| 37 | Golden Set Generation | Auto-generate questions + expected answers |
| 38 | Multi-Judge Evaluation | 2 LLM judges score independently |
| 39 | 10+ Metrics Evaluation | NDCG / Recall / Faithfulness / Groundedness / Citation / Coherence / Fluency / Completeness |
| 40 | Evaluation Report Management | Historical report list + comparison functionality |

#### 8.11 Proactive Generation

| # | Feature | Description |
|---|------|------|
| 41 | Action Item Parsing | Extract Action Items from Teams meeting notes |
| 42 | Smart Knowledge Source Discovery | Auto-search related knowledge sources based on Action Items |
| 43 | Proactive Generation & Suggestions | Suggest to user after quality met, supports view/edit/ignore |

#### 8.12 Workflow

| # | Feature | Description |
|---|------|------|
| 44 | Workflow Definition | User defines multi-step processes via visual editor or Chat Box |
| 45 | Workflow Execution | Auto-execute by steps, data passing between steps |
| 46 | Workflow Triggering | Supports user manual triggering and auto-triggering (detect data updates) |

### P2 — Backlog

| # | Feature | Description |
|---|------|------|
| 47 | One-Click Demo | FakeCursor auto-demo similar to GraphMe |
| 48 | More Knowledge Sources | Feishu, WeChat, Xiaohongshu, Zhihu, etc. |
| 49 | More Templates | Business plans, academic reviews, product requirement docs, etc. |
| 50 | Template Sharing | Team shared template library |
| 51 | Batch Generation | Generate multiple documents at once |
| 52 | Collaboration Features | Multi-user shared knowledge base and evaluation results |
| 53 | User Feedback | Collect user feedback signals to improve generation quality |

---

## 8.13 Supplementary Notes

### RAG Pipeline Reference

The RAG engine's core algorithms and parameter configuration are **directly reused from the patentExaminator project**, including:

- Query Expansion (cross-language, synonym, Multi-Query)
- Hybrid Search (BM25 + vector + RRF + MMR)
- Reranker (three-tier fallback strategy)
- Groundedness Check (sentence-level verification)
- All parameter defaults

### UI Component Specifications

| Component | Layout | Interaction |
|------|------|------|
| Chat Box | Left panel, collapsible | Supports Rich UI Elements (tabs, buttons) |
| Outline Editor | Center main area | Drag-to-reorder, context menu |
| Document Viewer | Center main area | Click paragraph to expand generation tree |
| Generation Tree | Right panel, collapsible | Tree diagram + drag-to-regenerate |
| Trust Report | Right panel, below gen tree | Progress bars + trend chart |
| Evaluation Panel | Standalone page | Table + chart comparison |
| Settings Page | Standalone page | Form + connection test |

### Error Handling Strategy

| Scenario | Handling |
|------|---------|
| LLM API Timeout | Retry 3 times, interval 1s/2s/4s |
| LLM API Failure | Fallback to backup provider (if configured) |
| Embedding API Failure | Fallback to BM25 keyword search |
| Reranker API Failure | Fallback to heuristic weighted scoring |
| Groundedness Check Failure | Default pass, doesn't block user |
| Knowledge Source Connection Failure | Skip that source, continue with others |
| Document Parsing Failure | Mark as error, skip that document |
| Office.js API Failure | Prompt user to operate manually |

### Performance Metrics

| Metric | Target | Description |
|------|--------|------|
| First Page Load Time | < 3s | Web app initial load |
| Knowledge Source Index Speed | > 10 docs/min | Document parsing + chunking + vectorization |
| Retrieval Response Time | < 2s | From query to result return |
| Document Generation Time | < 30s | From outline to complete document |
| Evaluation Run Time | < 5min | 50 Golden Set questions |
| Concurrent Users | > 10 | Users simultaneously using the system |
| Vector Index Memory | < 1GB | Vector index for 1000 documents |

---

## 9. People Graph — Org Chart & Interpersonal Relationship Graph

### Core Insight

Documents are created by people and read by people. Relationships between people (superior/subordinate, colleagues, cross-department) **heavily influence** documents:

- **Content Depth**: Report to boss vs. sharing with colleagues
- **Word Choice**: Formal vs. casual
- **Information Trade-offs**: What to detail, what to omit
- **Writing Style**: Direct vs. diplomatic

### Scenario Comparison

```
Same project progress, two different documents:

Weekly Report to Colleague:
─────────────────────────
"Auth module done this week, integration passed. Hit a snag with
OAuth2 redirect_uri config, took half a day. Next week tackling
payment module, expect to finish by Friday."

Quarterly Review to Department Director:
────────────────────────────────────────
"This quarter, the user authentication module has been fully
developed and passed integration testing, aligned with the Q2
roadmap. The OAuth2 protocol compatibility issue was resolved
without impacting the delivery timeline. The next phase will
initiate payment system development, expected mid-Q3 completion."
```

**Same knowledge, different audiences, completely different documents.**

### Data Sources

| Source | Acquisition Method | Signal |
|------|---------|------|
| Microsoft Graph API | Org chart API | Reporting relationships, department affiliation, job level |
| Teams Chat History | Graph API | Who communicates with whom, communication frequency |
| Email Correspondence | Graph API | Who emails whom, email tone |
| Document Sharing | Graph API | Who shares docs with whom, collaboration frequency |
| GitHub | GitHub API | Who reviews whose PRs, collaboration relationships |
| User Manual Tagging | Chat Box | User directly states "this is for the boss" |

### Data Structure

```
┌─────────────────────────────────────────────────────────────┐
│  People Graph                                                │
│                                                              │
│  Node: Person                                                │
│  ├─ id, name, email                                          │
│  ├─ department, title, level                                 │
│  └─ communication_style (learned from historical docs)       │
│                                                              │
│  Edge: Relationship                                          │
│  ├─ type: reports_to / colleague / cross_team / external     │
│  ├─ strength: 0-1 (based on communication frequency)         │
│  └─ formality: 0-1 (based on historical communication style) │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### How It Influences Document Generation

**1. Audience Identification**

```
User Input: "Write a project progress report for Mike"

System queries People Graph:
├─ Who is Mike? → Department Director
├─ Mike's relationship to me? → My superior's superior
├─ Mike's communication style? → Formal, data and ROI focused
│
└─ Decision: Generate formal, data-driven, executive-level document
```

**2. Automatic Style Adjustment**

| Audience Relationship | Content Depth | Word Choice | Information Density |
|---------|---------|---------|---------|
| Direct Superior | Medium | Formal | Medium |
| Executive Leadership | Strategic perspective | Very formal | Concise |
| Colleagues | Detailed | Casual | Detailed |
| Cross-department | Moderate | Formal | Medium |
| External Clients | Professional | Very formal | Refined |

**3. Knowledge Source Priority Adjustment**

```
Writing Report for Boss:
├─ Prioritize: Executive data, milestones, ROI metrics
└─ Secondary: Technical details, implementation plans

Writing Sharing for Colleagues:
├─ Prioritize: Technical details, pitfalls, code examples
└─ Secondary: Executive data, strategic context
```

### User Interaction

**Method 1: Chat Box Auto-Identification**

```
User: "Write a project progress report for Mike"

System: Identified Mike in People Graph
    ├─ Mike: Department Director
    ├─ Relationship: Your superior's superior
    └─ Style: Formal, data-driven

    Suggestion: Generate formal quarterly review style, is that OK?
    [Confirm] [Adjust]
```

**Method 2: User Manual Specification**

```
User: "Write a project weekly report"

System: Who is the audience for this document?
      [Colleague] [Direct Superior] [Executive] [Cross-dept] [External Client]

User: Clicks [Direct Superior]

System: Generating with formal, medium-depth style
```

### Priority

**P0** — Core feature, must implement

People Graph is a key differentiator for document generation quality. Without People Graph, all generated documents have the same style and cannot truly meet user needs.

### Competitive Reference

| Product | Similar Feature | Takeaway |
|------|---------|--------|
| Microsoft Copilot | Read org chart | Get reporting relationships via Graph API |
| Grammarly Business | Team writing style | Learn team communication style |
| Notion | @mention people | Associate people and documents |
| Slack | Human interaction | Adjust tone by channel |

---

## 10. Proactive Generation — Action Item Based Auto-Generation

### Core Scenario

```
Teams Meeting Ends
    │
    ├─ Teams auto-generates meeting notes (with Action Items)
    │   └─ "John to draft feature MVP spec to clarify scope/motivation/metrics"
    │
    ├─ i-Write detects Action Item
    │
    ├─ Auto-collect related knowledge sources
    │   ├─ Teams chat records (previous discussions)
    │   ├─ Related docs (PRD, design docs)
    │   ├─ Excel (data analysis)
    │   ├─ PPT (demo presentation)
    │   └─ Email correspondence
    │
    └─ Proactively generates MVP Specification
        └─ Based on all related knowledge, not generated from scratch
```

### Design Points

**1. Action Item Parsing**

Extract from meeting notes:
- Owner
- Task type (draft / review / analyze / present)
- Document type (MVP spec / design doc / report / slides)
- Target (scope / motivation / metrics)

**2. Smart Knowledge Source Discovery**

Based on Action Item keywords, auto-search related knowledge sources:
- Teams channel discussions
- Related documents
- Excel data
- PPT presentations
- Email correspondence

Rank by relevance, select Top-K.

**3. Quality Gating**

```
Collect Signals → Internal Generation → Groundedness Check
    │
    ├─ Quality met → Suggest to user
    └─ Quality not met → Continue collecting, don't disturb user
```

**4. User Interaction**

```
┌─────────────────────────────────────────────────────┐
│  💡 From Teams Meeting: "Q3 Feature Planning"        │
│                                                      │
│  Action Item: John to draft feature MVP spec         │
│                                                      │
│  Collected related knowledge sources:                │
│  • Teams chat: #product-discussion (23 messages)     │
│  • Docs: PRD.md, design.md                           │
│  • Excel: user-research.xlsx                         │
│                                                      │
│  Preview: MVP Specification (Draft)                  │
│  ┌─────────────────────────────────────────────┐    │
│  │  Scope: ...                                  │    │
│  │  Motivation: ...                             │    │
│  │  Metrics: ...                                │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  [View Full Doc]  [Edit Before Use]  [Ignore]       │
└─────────────────────────────────────────────────────┘
```

**5. Teams Integration**

| Method | Description |
|------|------|
| Microsoft Graph API | Subscribe to Teams meeting end notification, read meeting notes |
| Teams Bot | i-Write joins meeting as Bot, listens to events |
| User Manual Trigger | User copies Action Item to i-Write |

### Core Value

1. **Meeting → Action**: Action Items auto-become executable documents
2. **Reduce Manual Work**: No need to spend 2 hours organizing after the meeting
3. **Knowledge Integration**: Auto-integrate scattered discussions, documents, and data
4. **Quality Assurance**: Generated from real knowledge, not made up

### Competitive Reference

| Product | Similar Feature | Takeaway |
|------|---------|--------|
| Microsoft Copilot in Teams | Auto-generate meeting notes | Action Item extraction method |
| Notion AI | Detect task deadlines, suggest report generation | Proactive suggestion interaction pattern |
| Slack AI | Auto-summarize channel discussions | Signal collection and aggregation method |
| Google Docs Smart Canvas | Auto-associate related docs | Knowledge source association logic |

---

## 11. Workflow — Multi-Step Document Generation Process

### Core Scenario

Users' document generation often follows fixed business processes, e.g., "Monthly Business Report":

```
Step 1: Read this month's model results from Excel
    ↓
Step 2: Generate Pivot Table for analysis based on data
    ↓
Step 3: Reference Word spec to explain the data
    ↓
Step 4: Combine text explanation and data analysis Pie chart into PPT briefing
    ↓
Step 5: Generate Review document
```

Many industries have similar fixed processes. Users define a workflow once, reuse it repeatedly, with stable quality and controllable process.

### User Definition Methods

**Method 1: Visual Drag-and-Drop Editor**

```
┌─────────────────────────────────────────────────────────────┐
│  Workflow Editor — "Monthly Business Report"                 │
│                                                              │
│  ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐      │
│  │Excel│───▶│Anal-│───▶│Spec │───▶│ PPT │───▶│Review│      │
│  │Data │    │ysis │    │     │    │Brief│    │ Doc  │      │
│  │     │    │Pivot│    │     │    │     │    │      │      │
│  └─────┘    └─────┘    └─────┘    └─────┘    └─────┘      │
│                                                              │
│  Each node configures:                                       │
│  - Input source (file / prev step output / knowledge base)   │
│  - Action (read / analyze / generate / reference)            │
│  - Output format (data / chart / document / PPT)             │
│                                                              │
│  [Save Workflow]  [Run]                                      │
└─────────────────────────────────────────────────────────────┘
```

**Method 2: Chat Box Description**

```
User: "Every month I need to first run the Excel model, then generate
      an analysis report based on the results, then combine the analysis
      and spec explanation into a PPT briefing"

System: Identified as a workflow request
    → Generate workflow draft
    → User confirm/adjust
    → Save as workflow template
```

### Execution Modes

**Reactive (User-Triggered)**

```
User clicks [Run] → Select data file → Auto-execute → Generate all documents
```

**Proactive (Auto-Triggered)**

```
Detect Excel data update → Auto-run workflow → Generate documents → Notify user
```

### Inter-Step Data Passing

```
┌─────────────────────────────────────────────────────────────┐
│  Step Configuration                                          │
│                                                              │
│  Step Name: Generate Pivot Table Analysis                    │
│                                                              │
│  Input:                                                      │
│  - Previous step output: model-results (Step 1 Excel data)  │
│  - Knowledge base: Related technical docs                    │
│                                                              │
│  Action:                                                     │
│  - Analyze data, generate Pivot Table                        │
│  - Generate charts (Pie / Bar / Line)                        │
│                                                              │
│  Output:                                                     │
│  - analysis-result (for next step)                           │
│  - charts (for PPT step)                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Competitive Reference

| Product | Similar Feature | Takeaway |
|------|---------|--------|
| Zapier | Multi-step automation | Trigger + Action connection method |
| GitHub Actions | Workflow definition | YAML definition + visual editor |
| Airflow | DAG workflows | Step dependencies and data passing |
| Notion Automations | Automated processes | Simple trigger + action config |
| LangChain | Chain / Pipeline | Multi-step LLM call orchestration |

### Core Value

1. **Process Standardization**: Define fixed business processes once, reuse repeatedly
2. **Quality Control**: Users have expectations for each workflow step, more confident in quality
3. **Efficiency Improvement**: No need to manually execute 5 steps each time, one-click completion
4. **Knowledge Reuse**: Workflows can be shared with the team, unifying work processes

### Priority

P1.5 — Implemented after P1 core features are complete, higher complexity.

---

## 12. Relationship with patentExaminator

patentExaminator is i-Write's technical prototype and vertical scenario validation:

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  patentExaminator (Patent Examination Scenario)              │
│  ──────────────────────────────                              │
│  ✅ RAG + Groundedness + Offline Evaluation                  │
│  ✅ Validated effective in high-precision scenarios           │
│                                                              │
│              │ Tech Stack Migration                           │
│              ▼                                               │
│                                                              │
│  i-Write (General Document Generation Scenario)             │
│  ──────────────────────────────                              │
│  ✅ Generalize to everyone's document creation               │
│  ✅ Add Narrative Engine + Generation Tree + Office Integ.   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. Environment Configuration

### .env File

```env
# LLM Provider (Testing only, production users configure in APP)
GEMINI_KEY=
MiMo_KEY=
Openrouter_KEY=

# Embedding/Reranker
siliconflow_Key=

# Microsoft Graph (Testing only)
MS_CLIENT_ID=
MS_CLIENT_SECRET=

# MSA Test Account (For automated testing and demos)
MSA_ACCOUNT=
MSA_PASSWORD=

# GitHub (Testing only)
GITHUB_TOKEN=
```

---

## 14. Naming

- **i-Write, a Document Generation Studio** — Full name (adopted)
  - i-Write = AI writes documents
  - Document Generation Studio = 文档生成工作台
  - Core philosophy: Let AI write documents, humans review documents
- i-Write — Short name
- Document Studio — Original name
- KnowledgeWeaver — Emphasizing knowledge weaving
- DocTrust — Emphasizing trust
- SourceCraft — Source + Craft
