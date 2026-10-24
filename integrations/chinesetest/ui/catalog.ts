import { useEffect, useMemo, useState } from "react";
import { validDate, type Command, type Plan, type Row, type Target } from "../protocol";

export const siteQueryKey = (t: Pick<Target, "kmId" | "ksType" | "ksDate">) => JSON.stringify([t.kmId, t.ksType, t.ksDate]);
type Entry = { data?: Row[]; error?: string };
type Request = (command: Command, args?: Row) => Promise<any>;

// Cache by API inputs, not candidate. Changes to time, fee or profile don't reload lists.
export function useChineseTestCatalog(request: Request, source: string, enabled: boolean, plans: Record<string, Plan>) {
  const targets = Object.values(plans).map(p => p.target);
  const signature = JSON.stringify({
    projects: [...new Set(targets.map(t => t.projectId).filter(v => /^\d+$/.test(v)))].sort(),
    formats: [...new Set(targets.map(t => t.ksType).filter(v => ["1", "2", "4"].includes(v)))].sort(),
    sites: [...new Set(targets.filter(t => /^\d+$/.test(t.kmId) && ["1", "2", "4"].includes(t.ksType) && validDate(t.ksDate)).map(siteQueryKey))].sort(),
  });
  const cache = useMemo(() => new Map<string, Promise<Row[]>>(), [source]);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ source: string; entries: Record<string, Entry> }>({ source, entries: {} });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const selection = JSON.parse(signature) as { projects: string[]; formats: string[]; sites: string[] };
    const jobs: Array<{ key: string; args: Row }> = [
      { key: "projects", args: { kind: "projects" } },
      ...selection.formats.map(ksType => ({ key: "directory:" + ksType, args: { kind: "directory", ksType } })),
      ...selection.projects.map(projectId => ({ key: "subjects:" + projectId, args: { kind: "subjects", projectId } })),
      ...selection.sites.map(key => { const [kmId, ksType, ksDate] = JSON.parse(key); return { key: "sites:" + key, args: { kind: "sites", kmId, ksType, ksDate } }; }),
    ];
    const timer = setTimeout(() => { void (async () => {
      // Bound the command queue; the runner also serializes catalog commands.
      for (const job of jobs) {
        if (stopped) return;
        let pending = cache.get(job.key);
        if (!pending) {
          pending = request("catalog", job.args).then(r => {
            const rows = job.key === "projects" ? r.data?.projectList : r.data;
            if (!Array.isArray(rows)) throw new Error("Danh mục ChineseTest chưa trả danh sách hợp lệ. Cập nhật runner rồi tải lại danh mục.");
            return rows;
          });
          cache.set(job.key, pending);
        }
        let entry: Entry;
        try { entry = { data: await pending }; }
        catch (e) { cache.delete(job.key); entry = { error: (e as Error).message }; }
        if (!stopped) setSnapshot(previous => ({ source, entries: { ...(previous.source === source ? previous.entries : {}), [job.key]: entry } }));
      }
    })(); }, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [request, source, enabled, signature, revision, cache]);
  const entries = snapshot.source === source ? snapshot.entries : {};
  return {
    loading: (target: Target) => enabled && ["projects",...(/^\d+$/.test(target.projectId)?["subjects:"+target.projectId]:[]),...(["1","2","4"].includes(target.ksType)?["directory:"+target.ksType]:[]),...(/^\d+$/.test(target.kmId)&&validDate(target.ksDate)?["sites:"+siteQueryKey(target)]:[])].some(key=>!entries[key]),
    projects: entries.projects?.data || [],
    subjects: (projectId: string) => entries["subjects:" + projectId]?.data || [],
    directory: (ksType: string) => entries["directory:" + ksType]?.data || [],
    sites: (target: Target) => entries["sites:" + siteQueryKey(target)]?.data || [],
    error: (target: Target) => [entries.projects, entries["subjects:" + target.projectId], entries["directory:" + target.ksType], entries["sites:" + siteQueryKey(target)]].find(e => e?.error)?.error,
    reload: () => { cache.clear(); setSnapshot({ source, entries: {} }); setRevision(v => v + 1); },
  };
}
