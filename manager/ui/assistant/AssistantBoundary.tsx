import { Component, type ReactNode } from "react";

export class AssistantBoundary extends Component<{ children: ReactNode; onClose(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("Assistant render failed", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <aside className="ai-panel ai-render-error" role="alert">
      <strong>Chưa mở được trợ lý</strong>
      <p>Phần trò chuyện gặp lỗi hiển thị. Các chức năng khác vẫn dùng được.</p>
      <button onClick={() => this.setState({ failed: false })}>Thử mở lại</button>
      <button onClick={this.props.onClose}>Đóng trợ lý</button>
    </aside>;
  }
}
