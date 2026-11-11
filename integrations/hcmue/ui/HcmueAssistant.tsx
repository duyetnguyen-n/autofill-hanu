import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Spinner } from "@fluentui/react-components";
import { ChatsCircle, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { type AssistantContext, type AssistantProposal, type AssistantReply, runObservation, runResultText } from "../assistant";
import { examKey, statusLabel, type Exam, type HcmueAccount, type Schedule } from "../protocol";
import { type AccountPlan, planForSchedule } from "./planning";
import { NoticeCenter } from "./HcmueNotice";

export interface AssistantScope {
  noticeCode?: string;
  scheduleId?: string;
  accountId?: string;
}
type Turn = { role: "user" | "assistant"; text: string; reply?: AssistantReply; result?: string };
type Draft = { accountId: string; plan: AccountPlan };
const localTime = (value: string) => new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
const emptyPlan: AccountPlan = { examKey: "", target: "", test: true };
const actionLabel = { prepare: "Xem trước lịch nháp", edit: "Xem trước thay đổi", arm: "Mở xác nhận bật lịch", reconcile: "Kiểm tra kết quả" };

export function HcmueAssistant({ scope, schedules, exams, accounts, liveEnabled, ready, canPrepare, busy, getContext, onClose, onPrepare, onScheduleAction, noticeHost }: {
  scope: AssistantScope;
  schedules: Schedule[];
  exams: Exam[];
  accounts: HcmueAccount[];
  liveEnabled: boolean;
  ready: boolean;
  canPrepare: boolean;
  busy: boolean;
  noticeHost?: ReactNode;
  getContext: (scope: AssistantScope) => Promise<AssistantContext>;
  onClose: () => void;
  onPrepare: (draft: Draft, expectedDraftId: string | null) => void;
  onScheduleAction: (action: "arm" | "reconcile", id: string) => string | undefined;
}) {
  const [scheduleId, setScheduleId] = useState(scope.scheduleId ?? "");
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const showNotice = useContext(NoticeCenter);
  const [draft, setDraft] = useState<Draft>();
  const requestRef = useRef<AbortController | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);
  const revealDraft = useCallback((panel: HTMLDivElement | null) => {
    panel?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => () => {
    const request = requestRef.current;
    requestRef.current = undefined;
    request?.abort();
  }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [turns, pending]);
  const schedule = schedules.find(s => s.id === scheduleId);
  const proposal = turns.at(-1)?.reply?.proposal;
  const preparedDraft = schedules.find(s => s.accountId === draft?.accountId && s.status === "prepared");
  const draftProblem = draft && (!ready ? "Kết nối và đối chiếu Runner trước khi chuẩn bị."
    : !canPrepare ? "Cập nhật Runner lên bản hỗ trợ tạo và sửa lịch từ trợ lý."
    : busy ? "Chờ thao tác hiện tại hoàn tất."
    : !draft.accountId ? "Chọn tài khoản HCMUE."
    : !draft.plan.examKey ? "Chọn đúng đợt thi. Bấm Tải kỳ thi ở màn HCMUE nếu danh sách còn trống."
    : !draft.plan.target ? "Nhập ngày và giờ gửi theo giờ Việt Nam."
    : !draft.plan.test && !liveEnabled ? "Tài khoản website cần quyền Live để đăng ký thật."
    : proposal?.action === "edit" && preparedDraft?.id !== schedule?.id ? "Chọn lịch nháp cần sửa ở đầu khung chat."
    : undefined);

  async function send(question: string) {
    const text = question.trim();
    if (!text || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const history = turns.slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 600) }));
    setTurns(old => [...old, { role: "user", text }]);
    setMessage("");
    setDraft(undefined);
    setPending(true);
    try {
      const originalScope = scheduleId === (scope.scheduleId ?? "");
      const context = await getContext({
        noticeCode: originalScope ? scope.noticeCode : undefined,
        scheduleId,
        accountId: schedule?.accountId ?? (originalScope ? scope.accountId : undefined),
      });
      const response = await fetch("/api/hcmue/assistant/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ message: text, history, context }),
      });
      const reply = await response.json() as AssistantReply & { error?: string };
      if (!response.ok) throw new Error(reply.error || "Chưa nhận được câu trả lời.");
      const run = context.run && (context.runnerConnected ? "" : "Theo trạng thái đã đọc gần nhất. ") + runResultText(context.run);
      const inspection = context.inspection;
      const report = inspection && `Báo cáo lúc ${localTime(inspection.checkedAt)}. Đọc được ${inspection.passed}/${inspection.total} mục kiểm tra.`;
      const issues = inspection?.issues?.map(issue => `${issue.check} (${issue.code})`).join(", ");
      setTurns(old => [...old, { role: "assistant", text: reply.answer, reply, result: [
        run, context.run && runObservation(context.run), report, issues && `Cần kiểm tra ${issues}.`,
      ].filter(Boolean).join(" ") }]);
    } catch (error) {
      if (requestRef.current !== controller) return;
      showNotice({ kind: "error", problem: {
        code: "HC-TRO-LY", title: controller.signal.aborted ? "Trợ lý chưa phản hồi kịp" : (error as Error).message,
        steps: ["Gửi lại câu hỏi sau ít phút. Bạn có thể xem hướng dẫn trong thông báo HCMUE ngay bây giờ."],
      } });
      setMessage(text);
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = undefined;
        setPending(false);
      }
    }
  }

  function openDraft(proposal: AssistantProposal) {
    const existing = proposal.action === "edit" && schedule?.status === "prepared" ? schedule : undefined;
    const accountId = schedule?.accountId ?? scope.accountId ?? (accounts.length === 1 ? accounts[0].id : "");
    const matches = exams.filter(exam => proposal.exam && exam.ten_cap_thi.replace(/\s/g, "").toUpperCase() === proposal.exam.replace(/\s/g, ""));
    const plan = existing ? planForSchedule(existing) : emptyPlan;
    setDraft({ accountId, plan: {
      examKey: matches.length === 1 ? examKey(matches[0]) : plan.examKey,
      target: proposal.target ?? plan.target,
      test: proposal.test ?? plan.test,
    } });
  }

  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className="hc-assistant">
      <DialogBody className="hc-assistant-body">
        <header className="hc-assistant-header">
          <DialogTitle><ChatsCircle size={23} weight="duotone" aria-hidden="true" /> Trợ lý HCMUE</DialogTitle>
          <button type="button" aria-label="Đóng trợ lý" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="hc-assistant-scope">
          {schedules.length > 0 && <Field label="Lịch cần xem">
            <Select value={scheduleId} disabled={pending} onChange={(_, data) => {
              setScheduleId(data.value); setDraft(undefined); setTurns([]);
            }}>
              <option value="">Hỏi chung về HCMUE</option>
              {[...schedules].reverse().map(s => <option key={s.id} value={s.id}>
                {s.exam.ten_cap_thi} · {localTime(s.targetAt)} · {accounts.find(a => a.id === s.accountId)?.identity.name ?? "Tài khoản đã đăng xuất"} · {statusLabel[s.status]}
              </option>)}
            </Select>
          </Field>}
        </div>
        <DialogContent className="hc-assistant-content" ref={logRef} tabIndex={0}>
          <div className="hc-assistant-turns" role="log" aria-label="Cuộc trò chuyện">
            {!turns.length && <>
              <article className="hc-assistant-turn hc-assistant-assistant"><p>Chào bạn! Mình có thể hướng dẫn dùng HCMUE, giải thích lỗi và kiểm tra trạng thái lịch.</p></article>
              <div className="hc-assistant-prompts">
                {scope.noticeCode && <Button size="small" onClick={() => void send("Thông báo này có nghĩa gì và tôi cần làm gì?")}>Giải thích thông báo</Button>}
                {schedule && <Button size="small" onClick={() => void send("Lần chạy này đã đăng ký được chưa?")}>Giải thích lần chạy</Button>}
                {scope.accountId && !schedule && <Button size="small" onClick={() => void send("Giải thích báo cáo kiểm tra hồ sơ/API.")}>Giải thích báo cáo</Button>}
                <Button size="small" onClick={() => void send("Hướng dẫn tạo lịch HCMUE")}>Cách tạo lịch</Button>
              </div>
            </>}
            {turns.map((turn, index) => <article className={`hc-assistant-turn hc-assistant-${turn.role}`} key={index}>
              {turn.role === "assistant" && <strong>{turn.reply?.source === "guide" ? "Hướng dẫn HCMUE" : "Trợ lý HCMUE"}</strong>}
              {turn.result && <p className="hc-assistant-result">{turn.result}</p>}
              <p>{turn.text}</p>
              {!!turn.reply?.references.length && <ul className="hc-assistant-sources" aria-label="Nguồn tham khảo">
                {turn.reply.references.map(ref => <li key={ref.id}><a href={`/hcmue-downloads/knowledge.html#${ref.id}`} target="_blank" rel="noreferrer">{ref.title}</a></li>)}
              </ul>}
            </article>)}
            {pending && <Spinner size="tiny" label="Đang tìm hướng dẫn…" />}
          </div>
          {proposal && !draft && <div className="hc-assistant-proposal">
            {proposal.action === "prepare" || proposal.action === "edit" ? <>
              <Button onClick={() => openDraft(proposal)} disabled={proposal.action === "edit" && schedule?.status !== "prepared"}>{actionLabel[proposal.action]}</Button>
              {proposal.action === "edit" && schedule?.status !== "prepared" && <small>Chọn một lịch nháp ở đầu khung chat rồi yêu cầu sửa lịch.</small>}
            </> : <>
              <Button disabled={!schedule || !ready || busy} onClick={() => {
                if (!schedule || (proposal.action !== "arm" && proposal.action !== "reconcile")) return;
                const reason = onScheduleAction(proposal.action, schedule.id);
                if (reason) showNotice({ kind: "error", problem: { code: "HC-TRO-LY-LICH", title: "Chưa thể thực hiện thao tác", steps: [reason] } });
              }}>{actionLabel[proposal.action]}</Button>
              {(!schedule || !ready || busy) && <small>{!schedule ? "Chọn lịch rồi gửi lại yêu cầu." : !ready ? "Kết nối và đối chiếu Runner để thao tác." : "Chờ thao tác hiện tại hoàn tất."}</small>}
            </>}
          </div>}
          {draft && <div className="hc-assistant-proposal" ref={revealDraft}>
            <strong>{proposal?.action === "edit" ? "Xem lại thay đổi lịch nháp" : "Xem trước lịch nháp"}</strong>
            <Field label="Tài khoản HCMUE">
              <Select value={draft.accountId} disabled={proposal?.action === "edit"} onChange={(_, data) => setDraft({ ...draft, accountId: data.value })}>
                <option value="">Chọn tài khoản</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.identity.name}</option>)}
              </Select>
            </Field>
            <Field label="Đợt thi">
              <Select value={draft.plan.examKey} onChange={(_, data) => setDraft({ ...draft, plan: { ...draft.plan, examKey: data.value } })}>
                <option value="">Chọn kỳ thi và đợt thi</option>
                {exams.map(exam => <option key={examKey(exam)} value={examKey(exam)}>{exam.ten_cap_thi} · Mở {exam.ngay_mo_dang_ky}</option>)}
              </Select>
            </Field>
            <Field label="Ngày và giờ gửi (giờ Việt Nam)">
              <Input type="datetime-local" step={1} value={draft.plan.target} onChange={(_, data) => setDraft({ ...draft, plan: { ...draft.plan, target: data.value } })} />
            </Field>
            <Field label="Chế độ">
              <Select value={draft.plan.test ? "test" : "live"} onChange={(_, data) => setDraft({ ...draft, plan: { ...draft.plan, test: data.value === "test" } })}>
                <option value="test">Diễn tập</option>
                <option value="live" disabled={!liveEnabled}>Đăng ký thật</option>
              </Select>
            </Field>
            {preparedDraft && <small>Lưu sẽ thay lịch nháp hiện tại của tài khoản, đặt lúc {localTime(preparedDraft.targetAt)}.</small>}
            {draftProblem && <small>{draftProblem}</small>}
            <Button appearance="primary" disabled={!!draftProblem} onClick={() => onPrepare(draft, preparedDraft?.id ?? null)}>Xác nhận chuẩn bị nháp</Button>
          </div>}
        </DialogContent>
        <form className="hc-assistant-form" onSubmit={event => { event.preventDefault(); void send(message); }}>
          <textarea aria-label="Câu hỏi của bạn" placeholder="Nhập câu hỏi…" value={message} maxLength={1200} rows={1}
            onChange={event => setMessage(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!pending) void send(message);
              }
            }} />
          <button type="submit" aria-label="Gửi câu hỏi" title="Gửi câu hỏi" disabled={pending || !message.trim()}>
            <PaperPlaneTilt size={21} weight="bold" aria-hidden="true" />
          </button>
        </form>
      </DialogBody>
      {noticeHost}
    </DialogSurface>
  </Dialog>;
}
