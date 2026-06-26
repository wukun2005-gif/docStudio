/**
 * Case Zustand Store
 * 照搬 patentExaminator 的 caseSlice：write-through + load-on-mount
 */
import { create } from "zustand";
import { localIso } from "../../../shared/src/datetime.js";
import type { DocumentCase, CaseWorkflowState } from "../../../shared/src/types/case.js";
import type { OutlineSection, DocumentFormat } from "../../../shared/src/types/generation.js";
import {
  createCase as repoCreateCase,
  readAllCases as repoReadAllCases,
  updateCase as repoUpdateCase,
  deleteCase as repoDeleteCase,
} from "../lib/caseRepo.js";

export interface CaseStore {
  cases: DocumentCase[];
  currentCase: DocumentCase | null;
  isLoading: boolean;

  // Case 管理
  loadCases: () => Promise<void>;
  createCase: (userRequest: string) => DocumentCase;
  openCase: (id: string) => void;
  deleteCase: (id: string) => void;
  setCurrentCase: (c: DocumentCase | null) => void;

  // Case 字段更新（write-through）
  updateTitle: (title: string) => void;
  updateUserRequest: (userRequest: string) => void;
  updateOutline: (outline: OutlineSection[]) => void;
  updateGeneratedContent: (content: string, trustScore?: number) => void;
  updateLastRunId: (runId: string) => void;
  updateFormat: (format: DocumentFormat) => void;
  updateWorkflowState: (state: CaseWorkflowState, errorMessage?: string) => void;
}

function persistCase(c: DocumentCase) {
  repoUpdateCase({ ...c, updatedAt: localIso() }).catch(console.error);
}

export const useCaseStore = create<CaseStore>((set, get) => ({
  cases: [],
  currentCase: null,
  isLoading: false,

  loadCases: async () => {
    set({ isLoading: true });
    try {
      const cases = await repoReadAllCases();
      set({ cases, isLoading: false });
    } catch (err) {
      console.error("[CaseStore] loadCases failed:", err);
      set({ isLoading: false });
    }
  },

  createCase: (userRequest: string) => {
    const now = localIso();
    const c: DocumentCase = {
      id: `case-${Date.now()}`,
      title: userRequest.slice(0, 50) || "新文档",
      userRequest,
      outline: [],
      format: "html",
      workflowState: "draft",
      createdAt: now,
      updatedAt: now,
    };
    console.log("[CaseStore] createCase", { id: c.id, userRequest: userRequest.slice(0, 50) });
    repoCreateCase(c).catch(console.error);
    set((prev) => ({ cases: [c, ...prev.cases], currentCase: c }));
    return c;
  },

  openCase: (id: string) => {
    const c = get().cases.find((x) => x.id === id) ?? null;
    set({ currentCase: c });
  },

  deleteCase: (id: string) => {
    repoDeleteCase(id).catch(console.error);
    set((prev) => ({
      cases: prev.cases.filter((x) => x.id !== id),
      currentCase: prev.currentCase?.id === id ? null : prev.currentCase,
    }));
  },

  setCurrentCase: (c) => {
    console.log("[CaseStore] setCurrentCase", { caseId: c?.id });
    set({ currentCase: c });
  },

  updateTitle: (title) => {
    const c = get().currentCase;
    if (!c) return;
    const updated = { ...c, title };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },

  updateUserRequest: (userRequest) => {
    const c = get().currentCase;
    if (!c) return;
    const updated = { ...c, userRequest };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },

  updateOutline: (outline) => {
    const c = get().currentCase;
    if (!c) {
      console.warn("[CaseStore] updateOutline: no currentCase, skipping");
      return;
    }
    console.log("[CaseStore] updateOutline", { caseId: c.id, outlineLength: outline.length });
    const updated = { ...c, outline };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },

  updateGeneratedContent: (content, trustScore) => {
    const c = get().currentCase;
    if (!c) return;
    const updated = { ...c, generatedContent: content, trustScore };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },

  updateLastRunId: (runId) => {
    const c = get().currentCase;
    if (!c) return;
    const updated = { ...c, lastRunId: runId };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },

  updateFormat: (format) => {
    const c = get().currentCase;
    if (!c) return;
    const updated = { ...c, format };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },

  updateWorkflowState: (workflowState, errorMessage) => {
    const c = get().currentCase;
    if (!c) return;
    const updated = { ...c, workflowState, errorMessage };
    set({ currentCase: updated, cases: get().cases.map((x) => x.id === c.id ? updated : x) });
    persistCase(updated);
  },
}));
