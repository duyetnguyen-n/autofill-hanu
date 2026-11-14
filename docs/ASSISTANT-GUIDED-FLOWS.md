# Danh mục luồng Trợ lý HANU hướng dẫn trực tiếp

Danh mục gồm 68 luồng theo giao diện HANU hiện có. Mở **Danh mục hướng dẫn** trong chat để tìm theo tên hoặc lọc theo ứng dụng. Có thể nhập mã luồng, chẳng hạn `HC-06`, trực tiếp trong chat. Những mục quản trị và ứng dụng chưa được bật tuân theo quyền của tài khoản. Luồng đăng nhập bắt đầu ở nút **Hướng dẫn đăng nhập** và tiếp tục trên trang Tài khoản khi quay lại từ Google.

## Đồng hành theo màn hình hiện tại

Thanh **Gợi ý · Theo dõi · Ngữ cảnh** nằm dưới tiêu đề trợ lý, không ghim lên
hội thoại. **Ngữ cảnh** mở thành màn riêng; bấm **Về cuộc trò chuyện** để trở lại.
Có thể xem trạng thái, lưu mục tiêu hoặc chọn lịch ở màn này.

Nhắn “sắp đki rồi, theo dõi giúp mình” để nhận tin tiến trình và kết quả từ đúng
lịch, tài khoản và máy. Có nhiều lịch thì chọn rõ đối tượng. Các tin mới dựa trên
trạng thái Runner hoặc lượt chạy, không suy luận từ click. Chỉ báo xác nhận khi
có bằng chứng; diễn tập và kết quả chưa rõ được phân biệt. Dừng theo dõi của AI
không dừng lịch. Xem [cách dùng và giới hạn](AI-COMPANION.md).

## Cách hướng dẫn dùng chung

- **Chỉ dẫn trên web.** Làm nổi đúng nút hoặc trường trên màn hình, hiển thị việc cần làm và giữ khung chat. Sau khi người dùng thao tác, đọc trạng thái mới để quyết định bước kế tiếp.
- **Mở giúp khi được yêu cầu.** Có thể mở menu, tab nội bộ, chi tiết hoặc chuyển trang. Khi có nhiều profile, tài khoản, máy, lịch hoặc người dùng phù hợp, hỏi người dùng chọn đúng đối tượng.
- **Xác nhận thao tác.** Dừng ở nút lưu, đăng ký, gửi, bật lịch, dừng lượt, tải ảnh lên, xóa hoặc đổi quyền. Người dùng kiểm tra và xác nhận trên giao diện. Chỉ báo hoàn tất khi ứng dụng xác nhận trạng thái tương ứng.
- **Chuyển tiếp ra ngoài web.** Với Chrome extension, hộp chọn tệp, Runner, CAPTCHA/OTP hoặc trang trường, chỉ người dùng đến đúng nơi, cho họ biết cần làm gì rồi tiếp tục khi có trạng thái xác nhận trên HANU. Khi HANU chưa đọc được kết quả, dùng nút đọc lại hoặc yêu cầu người dùng đối chiếu.
- **Khi bị chặn.** Giải thích đúng nguyên nhân như thiếu quyền, thiếu ảnh, sai phiên, máy offline, lịch đang chạy, đã khóa gửi hoặc đang tải. Trỏ đến bước khắc phục khả dụng.

## Dùng chung · 7 luồng

| Mã | Người dùng muốn | Trợ lý dẫn đến |
| --- | --- | --- |
| CH-01 | Đăng nhập HANU lần đầu | Tiếp tục với Google → chọn tài khoản → trang Tài khoản → kiểm tra xác minh email và trạng thái duyệt. Điểm vào hướng dẫn cần xuất hiện trên màn đăng nhập vì khung chat hiện có yêu cầu tài khoản hoạt động. Bước Google thực hiện ngoài HANU. |
| CH-02 | Kiểm tra quyền, hạn dùng hoặc quyền Live | **Đã triển khai cho tài khoản hoạt động.** Tài khoản và công cụ → Tài khoản → Quyền sử dụng của bạn hoặc Chế độ Live. Trợ lý đọc quyền, hạn dùng và hạn mức hiện tại. Tài khoản chưa hoạt động xem trạng thái trực tiếp trên màn Tài khoản. |
| CH-03 | Chuyển sang ứng dụng khác | **Đã triển khai.** Chọn Google Forms, Direct, HCMUE hoặc ChineseTest từ thanh bên hoặc menu tài khoản. Trợ lý báo khi ứng dụng chưa được bật và giữ chat khi mở đúng màn. |
| CH-04 | Tìm hướng dẫn hoặc gói cài đúng máy | Hướng dẫn của ứng dụng hiện tại → đúng gói extension hoặc Runner. Dừng tại bước chọn bản theo hệ điều hành và kiến trúc. |
| CH-05 | Đổi giao diện sáng hoặc tối | Header → nút đổi giao diện → xác nhận chế độ hiển thị đã đổi. |
| CH-06 | Đăng xuất hoặc đổi tài khoản HANU | Tài khoản và công cụ → Đăng xuất → trang đăng nhập → chọn tài khoản Google. Dừng để người dùng xác nhận danh tính. |
| CH-07 | Hỏi về lỗi hoặc trạng thái đang thấy | Mở thông báo, báo cáo hoặc chi tiết lượt đúng đối tượng → đọc trạng thái và hướng xử lý → làm nổi bước khắc phục. Nếu lỗi xảy ra bên ngoài HANU, chuyển tiếp theo hướng dẫn tương ứng. |

Đối chiếu với [CloudLogin](../manager/ui/CloudLogin.tsx), [AccountPage](../manager/ui/AccountPage.tsx), [WorkspaceHeader](../manager/ui/WorkspaceHeader.tsx) và [WorkspaceSidebar](../manager/ui/WorkspaceSidebar.tsx).

## Google Forms và Google Forms Direct · 18 luồng

| Mã | Người dùng muốn | Trợ lý dẫn đến |
| --- | --- | --- |
| GF-01 | Cài extension lần đầu | Hướng dẫn cài extension → tải và giải nén → mở trang Tiện ích Chrome → tải thư mục trong đúng Chrome profile → mở HSK Autofill. |
| GF-02 | Liên kết thêm Chrome profile | **Đã triển khai.** Thêm profile → tạo mã → dán vào extension của profile đã chọn → chờ HANU xác nhận đúng mã. Khi mã hết hạn, làm nổi nút tạo mã mới. |
| GF-03 | Kết nối lại profile cũ | Chi tiết → Kiểm tra kết nối hoặc Mở profile. Xác định đúng Chrome profile và tài khoản HANU. Chỉ dẫn Liên kết lại khi tình trạng profile yêu cầu. |
| GF-04 | Chuẩn bị hồ sơ và ảnh | **Đã triển khai.** Chọn đúng profile → kiểm tra tên và email Google → dữ liệu thí sinh → ảnh và tệp → Lưu và đồng bộ. Báo thiếu email, mất kết nối, xung đột hoặc lỗi lưu tại bước liên quan. Chỉ hoàn tất khi extension xác nhận đồng bộ. |
| GF-05 | Sửa xung đột đồng bộ | Chi tiết → đọc bản từ extension và bản app đã lưu → người dùng chọn đúng bản → kiểm tra lại trạng thái đồng bộ. |
| GF-06 | Chuyển hồ sơ từ bản local lên web | Bản local → Xuất dữ liệu → trên web mở Tài khoản và công cụ → Nhập từ bản local → chọn JSON → kiểm tra hồ sơ, ảnh, khóa gửi và liên kết lại profile. |
| GF-07 | Chọn profile và cấp HSK | Quản lý các phiên → lọc/tìm profile → đặt HSK từng dòng → chọn profile → Đăng ký theo cấp độ HSK. Báo profile chưa chuẩn bị được và lý do. |
| GF-08 | Săn link theo bài Facebook | Nguồn link và thời gian chờ → Tự lấy từ Facebook → bài thông báo, profile đọc nguồn và giờ → kiểm tra quyền Facebook trong extension → Bật & chuẩn bị. |
| GF-09 | Dán link thủ công theo cấp HSK | Nguồn link → Dán link thủ công → bật lượt chờ → dán vào ô của đúng cấp hoặc dán nội dung bài có nhãn HSK. Báo trước khi áp dụng vì link hợp lệ có thể kích hoạt lượt ngay. |
| GF-10 | Diễn tập bằng form thử | Chọn Test và Diễn tập bằng form thử → chọn link thử → chuẩn bị → theo dõi trạng thái dừng trước Gửi. Có nhánh đổi form thử khi sai link. |
| GF-11 | Chạy Live theo cấp HSK | Chọn Live → kiểm tra quyền, profile và nguồn link → dừng ở Bật & chuẩn bị Live → theo dõi kết quả của từng cấp. |
| GF-12 | Cài hoặc sửa đáp án xác thực | Mở hàng đúng HSK → nhập trước đáp án hoặc Lấy câu xác thực khi lượt đã chặn → chọn đúng câu và form → Lưu đáp án. Nếu nhiều câu, để người dùng chọn. |
| GF-13 | Đổi link sai hoặc dừng một cấp | Hàng đúng HSK → Loại link / dừng HSK → chờ xác nhận dừng → Đổi link & chạy lại. Kiểm tra khóa gửi và câu xác thực cần thiết lập lại. |
| GF-14 | Theo dõi hoặc điều khiển lượt | Bảng theo dõi hoặc Chi tiết profile → chọn đúng lượt → Tạm dừng, Tiếp tục, Hủy chờ link hoặc Dừng. Xác nhận phạm vi nhóm hoặc từng profile. |
| GF-15 | Dùng Direct và tiếp quản form | Google Forms Direct → chọn profile và Test/Live → thiết lập lượt → Xem form khi cần thao tác thủ công → trở lại HANU và Tiếp tục khi phù hợp. |
| GF-16 | Xem lỗi, lịch sử hoặc hồ sơ đã dùng | Chi tiết profile → Nhật ký lượt chạy → chọn lượt và Xem hồ sơ của lượt này. Phân biệt dữ liệu đã dùng với bản hồ sơ đang sửa. |
| GF-17 | Đối chiếu đã gửi hay chưa và chạy lại | Chi tiết → Xác minh kết quả → Xem form để đối chiếu → người dùng ghi nhận kết quả. Chỉ đưa đến Chạy lại khi trạng thái hiện tại cho phép. |
| GF-18 | Hủy liên kết và xóa profile | Chi tiết → Hủy liên kết → kiểm tra đúng profile, dữ liệu và tác động tới lượt → dừng tại xác nhận Xóa vĩnh viễn. |

Đối chiếu với [Quản lý profile](../manager/ui/main.tsx), [Điều khiển lịch HSK](../manager/ui/RegistrationSchedule.tsx), [Câu xác thực HSK](../manager/ui/HskVerification.tsx), [Theo dõi lượt](../manager/ui/LiveRunBar.tsx), [Hướng dẫn lịch](SCHEDULED-HSK.md) và [Cài extension](forms/index.html).

## HSK HCMUE · 14 luồng

| Mã | Người dùng muốn | Trợ lý dẫn đến |
| --- | --- | --- |
| HC-01 | Cài, mở hoặc cập nhật HCMUE Runner | Hướng dẫn kết nối → gói đúng máy → mở Start HCMUE → kết nối website hoặc Mở runner trên máy này → xác nhận runner đã lên. |
| HC-02 | Liên kết và xác minh máy | Liên kết máy → nhập mã từ Runner → so sánh toàn bộ dấu vân tay → người dùng xác nhận đúng máy. |
| HC-03 | Chọn máy hoặc xử lý offline | Máy thực hiện đăng ký → chọn máy → đặt ưu tiên nếu muốn → Đọc lại trạng thái. Giải thích lịch thuộc máy nào và tình trạng kết nối. |
| HC-04 | Thêm, đăng nhập lại hoặc đăng xuất tài khoản thi | Tài khoản đăng ký → thao tác trên đúng dòng → người dùng nhập CCCD/mật khẩu vào hộp của ứng dụng → chờ trạng thái phiên. |
| HC-05 | Xem kỳ thi và tình trạng mở | Kỳ thi từ trường → Tải kỳ thi → chọn đợt → Xem toàn bộ dữ liệu kỳ thi. Chỉ ra trường trả gì về ngày mở, ngày đóng và số chỗ. |
| HC-06 | Kiểm tra hồ sơ/API | Chọn tài khoản và kỳ thi → Kiểm tra hồ sơ/API → đọc từng mục về hồ sơ, ảnh, email, câu hỏi, lịch cũ và trùng lịch. Dẫn ra trang trường khi cần sửa hồ sơ. |
| HC-07 | Chọn kỳ thi, giờ gửi và chế độ | Chọn theo từng dòng hoặc áp dụng mẫu cho những tài khoản được chọn → kiểm tra kỳ thi, giờ Việt Nam, Diễn tập/Live. |
| HC-08 | Tạo hoặc sửa lịch nháp | Chuẩn bị tài khoản hoặc Hỏi AI về lịch → xem lại kỳ thi, giờ, chế độ → nhập câu hỏi bổ sung nếu có → chờ trạng thái Sẵn sàng. |
| HC-09 | Bật lịch diễn tập | Chọn lịch nháp Diễn tập → mở xác nhận bật → người dùng xác nhận → theo dõi kết quả diễn tập. |
| HC-10 | Bật lịch đăng ký thật | Chọn đúng lịch đã chuẩn bị → kiểm tra quyền Live, phiên, hồ sơ, giờ và điều kiện mở → dừng tại xác nhận bật lịch → kiểm tra máy đã nhận. |
| HC-11 | Xem trạng thái lịch, lỗi và nhật ký | Lịch gửi và kết quả → chọn lượt → Xem lỗi, Hỏi AI về lịch hoặc mở báo cáo. Đọc đúng trạng thái trước giờ gửi, đang gửi, hàng đợi hoặc chờ thanh toán. |
| HC-12 | Đối chiếu kết quả và mở trang thanh toán | Chọn lượt chưa rõ → Kiểm tra kết quả → kiểm tra lịch sử trên HCMUE. Nếu có mã đơn, chỉ đường đến lịch sử và hạn thanh toán do trường hiển thị. |
| HC-13 | Dừng hoặc khôi phục sau sự cố | Chọn đúng lịch hoặc Dừng tất cả → chờ máy xác nhận. Nếu máy offline, chuyển hướng dẫn sang Runner tại máy. Sau khởi động lại, đối chiếu lượt có khả năng đã gửi trước khi chuẩn bị lượt mới. |
| HC-14 | Bỏ một lịch nháp | Lịch gửi và kết quả → tìm lịch Sẵn sàng theo tài khoản, kỳ thi và giờ → Bỏ lịch → kiểm tra nháp đã rời danh sách. Với lịch đã bật, chuyển sang luồng dừng. |

Đối chiếu với [Màn HCMUE](../integrations/hcmue/ui/Page.tsx), [Trợ lý theo lịch](../integrations/hcmue/ui/HcmueAssistant.tsx) và [Hướng dẫn HCMUE](hcmue/HUONG-DAN.md).

## ChineseTest · 14 luồng

| Mã | Người dùng muốn | Trợ lý dẫn đến |
| --- | --- | --- |
| CT-01 | Cài, mở hoặc cập nhật ChineseTest Runner | Hướng dẫn kết nối → tải gói đúng máy → mở Start ChineseTest → kết nối website → kiểm tra trạng thái Runner. |
| CT-02 | Liên kết và đối chiếu máy | Liên kết máy → nhập mã → đối chiếu toàn bộ dấu vân tay → xác nhận. |
| CT-03 | Chọn máy hoặc xử lý mất kết nối | Máy thực thi → chọn máy → Đọc lại trạng thái → giải thích máy đang giữ phiên/lịch. Nếu cần dừng khi mất mạng, hướng dẫn tại Runner. |
| CT-04 | Thêm tài khoản hoặc đăng nhập lại | Thêm tài khoản/Đăng nhập lại → chuyển sang cửa sổ Chrome do Runner mở → người dùng xử lý mật khẩu, CAPTCHA/OTP → Hoàn tất đăng nhập hoặc Hủy đăng nhập. |
| CT-05 | Điền hồ sơ hoặc lấy dữ liệu từ HANU | Hồ sơ / ảnh → nhập hoặc chọn hồ sơ có sẵn → rà các trường còn thiếu, gồm lịch sử thi nếu yêu cầu → Lưu hồ sơ. |
| CT-06 | Tải ảnh hoặc đọc lại ảnh | Hồ sơ / ảnh → kiểm tra định dạng và kích thước → người dùng chọn ảnh để tải trực tiếp lên ChineseTest → chờ trang đọc và hiển thị lại ảnh. |
| CT-07 | Tìm cấp thi, hình thức, ngày và điểm thi | Cấu hình kỳ thi và giờ mở → tải danh mục → lọc điểm thi → chọn kỳ thi và giờ Việt Nam → kiểm tra phí và môn đi kèm → Lưu cấu hình. |
| CT-08 | Áp dụng mẫu cho nhiều tài khoản | Chọn đúng các tài khoản → Áp dụng mẫu Dong A → kiểm tra và sửa các dòng cần thiết. |
| CT-09 | Kiểm tra API trước khi chuẩn bị | Kiểm tra API trên đúng tài khoản → đọc kết quả kiểm tra phiên, hồ sơ và điều kiện → hướng dẫn sửa lỗi mạng hoặc đăng nhập lại theo nguyên nhân. |
| CT-10 | Chuẩn bị và bật lịch Test | Chọn chế độ Test → Chuẩn bị → Bật lịch Test → đọc trạng thái diễn tập. |
| CT-11 | Chuẩn bị và bật lịch Live | Chọn Live → xem kỳ thi và lệ phí → người dùng xác nhận quy định và quyền riêng tư → chuẩn bị → dừng ở nút bật lịch Live của đúng tài khoản hoặc nhóm. |
| CT-12 | Theo dõi hoặc đối chiếu kết quả | Lịch và kết quả → chọn lượt → đọc trạng thái dò/gửi → Đối chiếu kết quả hoặc mở Test Records. Chỉ xác nhận đăng ký theo kết quả thực tế. |
| CT-13 | Xác minh đã hủy hoặc chưa có đăng ký | Chọn đúng lượt → Xác minh đã hủy / đăng ký lại hoặc Xác minh chưa đăng ký → kiểm tra Test Records và tình trạng yêu cầu → người dùng xác nhận → chờ trạng thái mở khóa. |
| CT-14 | Dừng lượt hoặc xử lý sau khi Runner khởi động lại | Dừng lượt hoặc Dừng tất cả trên máy → đọc xác nhận → đối chiếu yêu cầu có thể đã gửi. Chỉ chuẩn bị lại khi trạng thái cho phép. |

Đối chiếu với [Màn ChineseTest](../integrations/chinesetest/ui/Page.tsx), [Hồ sơ](../integrations/chinesetest/ui/ProfileEditor.tsx), [Xác minh](../integrations/chinesetest/ui/AbsenceDialog.tsx) và [Hướng dẫn ChineseTest](chinesetest/HUONG-DAN.md).

## Quản trị · 8 luồng

| Mã | Người dùng muốn | Trợ lý dẫn đến |
| --- | --- | --- |
| QT-01 | Vào Quản trị | **Đã triển khai.** Tài khoản và công cụ → Quản trị. Trợ lý báo thiếu quyền khi cần và tiếp tục chat sau khi sang trang. |
| QT-02 | Tìm người dùng và xem chi tiết | Người dùng → lọc trạng thái hoặc tìm tên/email → Chi tiết tài khoản → chọn Quyền sử dụng, Profile hoặc Nhật ký. |
| QT-03 | Duyệt, khóa, từ chối hoặc gia hạn | Người dùng → chọn đúng tài khoản → Quyền sử dụng → chọn trạng thái/hạn → người dùng xác nhận và kiểm tra kết quả lưu. |
| QT-04 | Chỉnh hạn mức hoặc quyền Live | Chi tiết tài khoản → Quyền sử dụng → hạn mức profile, chạy đồng thời, Live, hạn hoặc ghi chú → Lưu quyền sử dụng. |
| QT-05 | Cấp quyền quản trị | Chi tiết tài khoản → Vai trò tài khoản → kiểm tra email đã xác minh và tài khoản hoạt động → dừng tại Xác nhận cấp quyền quản trị. |
| QT-06 | Cấp trước hoặc gỡ quyền theo email | Quyền cấp trước → nhập email Google, hạn mức và hạn sử dụng hoặc chọn quyền đang chờ để gỡ → xác nhận đúng email trước khi áp dụng. |
| QT-07 | Thu hồi liên kết một profile | Chi tiết tài khoản → Profile → chọn chính xác profile → Thu hồi → dừng tại xác nhận. |
| QT-08 | Xem nhật ký thay đổi | Nhật ký quản trị hoặc Nhật ký của tài khoản → xem người thực hiện, thời điểm và thao tác cần đối chiếu. |

Đối chiếu với [Màn Quản trị](../manager/ui/AdminPage.tsx) và [Điểm vào Quản trị](../manager/ui/assistant/guide.ts).

## Kho tri thức và vector · 7 luồng

| Mã | Người dùng muốn | Trợ lý dẫn đến |
| --- | --- | --- |
| KT-01 | Mở kho và tìm tài liệu | Kho tri thức & vector → tìm theo tiêu đề hoặc lọc phạm vi ứng dụng → mở tài liệu hoặc đoạn được trích dẫn. |
| KT-02 | Khám phá bản đồ 3D/2D | Bản đồ vector → chọn chế độ → xoay, thu phóng hoặc đặt lại → chọn một điểm và đọc đoạn gốc. Giải thích khi kho chưa có điểm. |
| KT-03 | Thêm và xuất bản tài liệu | Thêm tài liệu → chọn phạm vi → nhập nội dung hoặc tải Markdown/TXT → xem trước các đoạn → dừng tại Xuất bản. |
| KT-04 | Lập chỉ mục bài hướng dẫn có sẵn | Bản đồ hoặc Tài liệu → Lập chỉ mục bài có sẵn → người dùng bấm → kiểm tra số đoạn có vector. Nêu thiếu OpenRouter nếu nút bị vô hiệu hóa. |
| KT-05 | Tạo vector cho tài liệu đã đăng | Tài liệu → tìm đúng tài liệu thiếu vector → Tạo vector → chờ số đoạn cập nhật. |
| KT-06 | Ẩn tài liệu | Tài liệu → chọn đúng tiêu đề và phạm vi → dừng ở nút Ẩn để người dùng xác nhận ý định → kiểm tra tài liệu đã rời truy xuất. |
| KT-07 | Thử truy xuất và so sánh | Thử truy xuất → nhập câu hỏi → so sánh từ khóa, vector và kết hợp → tùy chọn xếp hạng lại → mở đoạn gốc để đối chiếu. |

Đối chiếu với [Kho tri thức](../integrations/hcmue/ui/KnowledgePage.tsx) và [Bản đồ vector](../integrations/hcmue/ui/KnowledgeMap.tsx).

## Nhóm cần đối chiếu khi thay đổi giao diện

| Đợt | Luồng | Kết quả cần kiểm tra |
| --- | --- | --- |
| 1 · Tìm đường và tự kiểm tra | CH-02, CH-03, GF-02, GF-04, HC-05, HC-06, CT-07, CT-09, QT-02, KT-02 | Người dùng tới đúng màn, chọn đúng đối tượng, hỏi thêm khi đang hướng dẫn. Đổi trang hoặc chuyển sang mobile vẫn chỉ đúng nút. |
| 2 · Chuẩn bị và diễn tập | GF-07 đến GF-10, GF-12, HC-07 đến HC-09, CT-05, CT-06, CT-10, KT-03 đến KT-05 | Nhìn thấy các bước nhập, xem lại và xác nhận. Hỗ trợ luồng quay lại HANU sau khi thao tác ngoài web. |
| 3 · Live, kết quả và quản trị | GF-11, GF-13 đến GF-18, HC-10 đến HC-14, CT-11 đến CT-14, QT-03 đến QT-08, KT-06 và KT-07 | Xác định đúng đối tượng và phạm vi, dừng ở thao tác có tác động và đọc phản hồi thật. |
| Bổ sung theo từng đợt | Các luồng dùng chung, cài đặt và khôi phục còn lại | Hiện điểm bàn giao rõ ràng khi sang extension, Runner hoặc website ngoài. |

Khi sửa giao diện, đối chiếu các điểm được đánh dấu và điều kiện chuyển bước trong `manager/ui/assistant/walkthrough-*.ts`. Hướng dẫn có thể chờ điều khiển hoặc kết quả xuất hiện, hoặc yêu cầu người dùng bấm **Tiếp theo** khi cần tự đối chiếu. Các bước ngoài HANU cần kiểm tra trên đúng Chrome profile, Runner hoặc trang trường. Bài kiểm tra giao diện đối chiếu đủ mã luồng trong danh mục và chạy các nhánh tiêu biểu bằng dữ liệu thử.
