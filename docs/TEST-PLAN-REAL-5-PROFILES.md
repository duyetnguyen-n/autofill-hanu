# Kế hoạch kiểm thử trước khi đăng ký thật bằng 5 profile

Ngày soạn: 17/10/2026. Bản đối chiếu hiện tại: 1.5.0, commit `9119db2`.

**Tài liệu này có 84 test case và là tiêu chí nghiệm thu đề xuất. Chưa chạy toàn bộ kế hoạch này; không coi việc có tên trong bảng là đã hỗ trợ hoặc đã đạt.** Yêu cầu sai tài khoản, sai dữ liệu, lẫn ảnh và gửi trùng là lỗi chặn sử dụng Live.

Không thể bảo đảm Google, mạng hoặc máy tính không gặp sự cố. Tiêu chí của ứng dụng là giữ đúng dữ liệu, cô lập profile lỗi, nhận diện điều chưa chắc chắn và không tự gửi thêm khi chưa biết lần trước đã được nhận hay chưa.

## 1. Chuẩn bị và cách ghi kết quả

- Gọi 5 Chrome profile là P1–P5; mỗi profile có tài khoản Google, liên kết extension và hồ sơ riêng. Dùng dữ liệu thử khác nhau rõ rệt để dễ phát hiện lẫn dữ liệu.
- Lập bảng chuẩn đối chiếu riêng: email Google, email liên hệ, họ tên, loại/số giấy tờ, ngày sinh, giới tính, quốc tịch, tiếng mẹ đẻ, thời gian học, thông tin ngân hàng, hai cam kết, tên tệp và SHA-256 nội dung ảnh. Không đưa giấy tờ/ảnh thật vào log chung hoặc git.
- Xác nhận bản cài của cả 5 profile cùng build; website/coordinator sẵn sàng; tài khoản ứng dụng có hạn mức ít nhất 5 profile đồng thời.
- Giữ hồ sơ/ảnh và các khóa gửi. Chỉ xóa bản nháp trong form thử đã được xác định là dùng để test.
- Ca gửi, mất xác nhận, lỗi server có chủ đích, đổi lease, hết hạn quyền và sửa dữ liệu đối nghịch chạy trên môi trường thử kiểm soát được. Không tạo các sự cố này trên lượt đăng ký thật.
- Google Form thử chạy **Test**, để trống câu xác thực; không gửi đăng ký thật. Ca cần thao tác xác thực/điều khoản phải do người dùng xử lý hoặc được xác nhận theo quy định của công cụ.
- Mỗi ca ghi: build, máy, profile, `runId`, thời điểm, bước gây lỗi, trạng thái trước/sau, số lần Next/Submit, ảnh chụp/log bằng chứng, kết quả Đạt/Không đạt/Bị chặn/Chưa chạy. Sau lỗi ghi rõ dữ liệu đã giữ được và thao tác cần để tiếp tục.

Mẫu ghi một ca:

| ID | Build | Profile/runId | Cách tái hiện thực tế | Kết quả quan sát | Next/Submit | Bằng chứng | Kết luận |
|---|---|---|---|---|---|---|---|
| … | … | … | … | … | … | … | Chưa chạy |

**P0:** chặn Live khi chưa đạt hoặc chưa có bằng chứng cho luồng sẽ sử dụng. **P1:** lỗi ảnh hưởng tốc độ/khả năng phục hồi; nếu không đạt phải có phương án xử lý được kiểm thử và được chấp nhận trước buổi thật. Đây không phải cam kết có thể tự phục hồi mọi trường hợp.

## 2. Tài khoản và chuẩn bị — 10 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| A01 | P0 | Liên kết đúng 5 profile, mỗi profile một email Google khác nhau. | P1–P5 giữ đúng liên kết; hồ sơ và ảnh đối chiếu được theo từng người. |
| A02 | P0 | P3 mở form bằng tài khoản Google khác email được cấu hình. | P3 dừng trước khi điền/upload; nêu sai tài khoản; P1/P2/P4/P5 vẫn chạy. |
| A03 | P0 | P3 đăng xuất hoặc phiên Google hết hạn lúc mở form. | Yêu cầu đăng nhập riêng P3; không lấy tài khoản của profile khác, không lặp tải vô hạn. |
| A04 | P0 | Đổi tài khoản Google sau bước kiểm tra ban đầu, trước bước tiếp theo hoặc Gửi. | Phát hiện thay đổi trước thao tác có hậu quả tiếp theo; dừng profile đó để đối chiếu. |
| A05 | P0 | Thiếu hồ sơ, một trường bắt buộc hoặc ảnh ở P3 khi Start nhóm. | P3 báo thiếu chính xác; 4 profile đủ điều kiện được khởi động độc lập. |
| A06 | P0 | Chọn 5 profile khi tài khoản chỉ được chạy 4 hoặc quyền dùng app hết hạn. | Không vượt quyền/hạn mức; liệt kê profile được/chưa được chạy; không báo cả nhóm thành công giả. |
| A07 | P0 | Một profile còn extension cũ hoặc chưa Reload sau cập nhật. | Phát hiện không tương thích nếu có; không âm thầm dùng lệnh sai phiên bản. |
| A08 | P0 | Hai Chrome profile cố dùng cùng một liên kết; hoặc liên kết đã bị hủy. | Không nhận nhầm phiên, không ghi đè hồ sơ; báo xung đột và giữ chủ sở hữu đúng. |
| A09 | P0 | Một extension mất quyền truy cập form/debugger hoặc bị extension khác giữ debugger. | Báo rõ riêng profile đó; không chuyển sang điều khiển cửa sổ của người khác. |
| A10 | P1 | Server đang ngủ/khởi động, website chưa sẵn sàng hoặc extension đang nối lại. | Hiển thị chưa sẵn sàng; không mất lệnh/đánh dấu chạy giả; đo riêng thời gian chờ này. |

## 3. Độ chính xác dữ liệu — 16 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| B01 | P0 | Cho 5 hồ sơ khác nhau chạy đồng thời. | Mỗi trường và ảnh thuộc đúng người, đúng Google profile; không dùng chung biến tạm hoặc ảnh của lượt khác. |
| B02 | P0 | Form có sẵn bản nháp cũ với tên, điện thoại, ngân hàng khác hồ sơ. | Đối chiếu và thay đúng theo hồ sơ đã khóa của lượt, không coi “có dữ liệu” là đúng. |
| B03 | P0 | Tên trên nháp khác chữ hoa hoặc dấu so với giá trị lưu. | Văn bản sau điền khớp chính xác giá trị lưu; không dùng chuẩn hóa tên câu hỏi để chấp nhận sai dữ liệu người dùng. |
| B04 | P0 | Số giấy tờ, điện thoại, số tài khoản có số 0 đầu hoặc chuỗi dài. | Giữ đủ từng ký tự, không đổi sang số, không làm tròn, không cắt ngắn. |
| B05 | P0 | Ngày sinh có ngày/tháng dễ đảo; thử ngày đầu/cuối tháng và năm nhuận. | Hiển thị đúng ngày sinh dự kiến theo định dạng thực của form; dữ liệu không hợp lệ phải bị chặn. |
| B06 | P0 | Chọn CCCD ở P1, hộ chiếu ở P2; form đổi nhánh câu hỏi. | Mỗi profile đi đúng nhánh; không điền CCCD vào hộ chiếu hoặc dùng số của nhánh cũ. |
| B07 | P0 | Email liên hệ khác email Google dùng ghi nhận câu trả lời. | Hai email đi đúng vai trò; không thay email liên hệ bằng email Google hoặc ngược lại. |
| B08 | P0 | Dropdown đảo thứ tự, có placeholder/“Khác”, hoặc tải tùy chọn chậm. | Chọn theo nội dung đáp án chính xác, không theo thứ tự; chỉ Next sau khi đọc lại đúng. |
| B09 | P0 | Hai câu cùng tiêu đề “TÔI CAM KẾT” nhưng khác nghĩa; cho hai giá trị hồ sơ đối nghịch. | Phân biệt bằng nội dung câu/đáp án; cam kết tự đăng ký và điều khoản không mượn giá trị của nhau. |
| B10 | P0 | Radio/checkbox nhiều đáp án, có đáp án phủ định; đảo vị trí Việt/Trung. | Chọn đúng nghĩa và đúng giá trị lưu; không tự chọn mục đầu tiên khi chưa xác định được. |
| B11 | P0 | Tiêu đề thêm dấu *, khoảng trắng, xuống dòng hoặc nhãn Morse đã biết. | Ghép đúng các nhãn được hỗ trợ; nhãn lạ không được đoán thành trường khác. |
| B12 | P0 | Form thêm câu bắt buộc mới, đổi loại điều khiển hoặc bỏ một câu. | Dừng đúng câu chưa hỗ trợ; không Next/Gửi khi thiếu hoặc sai loại dữ liệu. |
| B13 | P0 | Người dùng sửa hồ sơ trên manager trong lúc lượt đang chạy. | Lượt hiện tại dùng nhất quán snapshot đã khóa; lần chạy mới dùng bản sửa mới; không pha hai phiên bản. |
| B14 | P0 | P3 sửa trực tiếp trường báo lỗi rồi bấm ra ngoài hoặc giữ focus. | Nhận biết khi giá trị hợp lệ; giữ sửa tay theo cơ chế đã kiểm chứng; không chạy tiếp nếu vẫn sai hoặc đã Pause rõ ràng. |
| B15 | P0 | Ảnh cùng tên nhưng nội dung khác, tệp sai định dạng/quá lớn/hỏng hoặc đã bị thay. | Dùng đúng nội dung ảnh đã khóa; không xác nhận chỉ dựa vào tên khi chưa có nguồn ảnh chắc chắn; lỗi chỉ chặn profile đó. |
| B16 | P0 | Sau khi điền, form tự reset một lựa chọn, cắt chuỗi hoặc báo validation. | Đọc lại trước Next; phát hiện khác dữ liệu dự kiến và dừng/sửa; không bỏ qua lỗi chỉ vì đã có log “Đã điền”. |

## 4. Cô lập 5 profile — 10 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| C01 | P0 | Start cả 5 cùng lúc từ nháp trống. | Phân biệt từng lượt bằng cặp sessionId/runId dù có chung runId nhóm; không trộn event; điền đồng thời, không tuần tự qua một hàng đợi toàn cục. |
| C02 | P0 | Giữ preflight/check capability của P3 chưa trả lời. | 4 profile khỏe vẫn được Start; P3 không giữ cả nhóm ở bước chuẩn bị. |
| C03 | P0 | P3 Next treo 25–30 giây. | Các profile khác tiếp tục; P3 có trạng thái chờ/phục hồi đúng, không bấm Next lặp vô hạn. |
| C04 | P0 | P3 bị CAPTCHA. | P3 chờ thao tác của người; 4 profile khác tiếp tục; không refresh vòng lặp để né CAPTCHA. |
| C05 | P0 | P3 thiếu trường hoặc upload ảnh lỗi. | Chỉ P3 dừng; ảnh/đáp án của P3 không làm thay đổi trạng thái hoặc dữ liệu profile khác. |
| C06 | P0 | Stop/Pause/Resume/Restart P3 khi 4 profile đang chạy. | Chỉ P3 bị tác động; trạng thái và lệnh của 4 profile còn lại giữ đúng. |
| C07 | P0 | Gây đồng thời P2 treo, P3 CAPTCHA, P4 lỗi ảnh; P1/P5 bình thường. | P1/P5 hoàn thành phần tự động; mỗi profile lỗi giữ nguyên nguyên nhân và đường xử lý riêng. |
| C08 | P0 | Đóng cửa sổ hoặc reload extension P3 giữa lượt. | Chỉ P3 cần đối chiếu; 4 profile khác không bị Stop/restart hoặc lấy lại renderer hàng loạt. |
| C09 | P0 | Thao tác Focus một profile bị treo, sau đó Stop profile đó và Restart profile khác. | Stop và thao tác profile khác vẫn được tiếp nhận; không khóa toàn giao diện theo lệnh Focus. |
| C10 | P1 | Đổi thứ tự chọn P1–P5, đổi profile được mở đầu tiên; lặp 3 lượt. | Không có một profile cố định bị bỏ đói; thời gian từng profile được ghi riêng. |

## 5. Điều khiển manager và extension — 10 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| D01 | P0 | Start từ manager rồi từ panel extension trên lượt thử riêng. | Cùng tài khoản, dữ liệu, mode, khóa gửi và quy tắc xử lý; không có đường Start bỏ qua kiểm tra. |
| D02 | P0 | Pause/Resume/Stop/Restart lần lượt từ hai giao diện. | Hành vi tương đương; trạng thái hai nơi đối chiếu được và không hiển thị thành công sớm khi chưa xác nhận. |
| D03 | P0 | Bấm Start hoặc Chạy lại nhanh hai lần. | Không tạo hai lượt cạnh tranh trong cùng profile; chỉ một lượt có quyền thực thi. |
| D04 | P0 | Start rồi Stop ngay khi một số profile còn chuẩn bị. | Profile đã chạy dừng; profile chưa chạy không được khởi động muộn từ lệnh Start cũ. |
| D05 | P0 | Pause ngay lúc đang điền/Next; sau đó gõ sửa một trường. | Không tự Resume một lệnh Pause rõ ràng; chỉ tiếp tục sau thao tác Resume hợp lệ. |
| D06 | P0 | Stop rồi nhận ACK/progress của lượt cũ đến muộn. | Không sống lại lượt đã Stop và không ghi đè trạng thái lượt mới. |
| D07 | P0 | Restart, rồi gửi Stop/Resume với runId cũ. | Lệnh cũ bị từ chối hoặc bỏ qua; không điều khiển nhầm run mới. |
| D08 | P0 | Mở 2 tab manager, thao tác trái nhau; ACK/HTTP trả về đảo thứ tự. | Có một trạng thái có thẩm quyền; không quay về trạng thái cũ do response đến muộn. |
| D09 | P0 | Manager reload/đóng tab trong khi extension đang chạy. | Không Start lại do reload manager; nối lại và hiển thị trạng thái thật, không tự gửi thêm. |
| D10 | P0 | Đổi nhóm chọn hoặc nhập đáp án chung cho một phần profile đang chờ. | Chỉ áp dụng vào đúng tập profile/câu hỏi/lượt đã chỉ định; không lan sang profile chưa chọn hoặc câu khác. |

## 6. Mạng, điều hướng và phục hồi — 12 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| E01 | P1 | Form mở chậm; ảnh, font hoặc tài nguyên phụ tải mãi. | Đọc form khi DOM/tài khoản đủ sẵn sàng; không chờ tài nguyên không liên quan; không điền khi DOM chưa đủ. |
| E02 | P0 | Bấm Next rồi Google chuyển trang rất chậm nhưng cuối cùng thành công. | Chỉ một lần Next cho điều hướng chưa rõ kết quả; nhận trang mới đúng run và tiếp tục. |
| E03 | P0 | Document POST trả một phần rồi đứng, content script cũ bị thay. | Watchdog nền vẫn theo dõi; phục hồi có giới hạn bằng đường mở an toàn khi được phép; không gửi lại POST mù. |
| E04 | P0 | Người dùng reload giữa trang thông tin; Google đưa về trang đầu. | Nhận biết trang hiện tại, đối chiếu và điền lại từ snapshot; không mặc định đang ở bước cũ. |
| E05 | P0 | Reload lúc upload, sau upload nhưng chưa có chip ảnh, và sau khi chip đã hiện. | Xác nhận lại tệp trên document mới; không dùng dấu “bỏ qua câu ảnh” cũ; không Next khi chưa chắc ảnh đã có. |
| E06 | P1 | Mạng mất trước/sau Next rồi phục hồi sau 3/10/30 giây. | Không nhân đôi điều hướng, không mất dữ liệu đã khóa; có trạng thái/phương án tiếp tục rõ ràng theo từng giai đoạn. |
| E07 | P1 | Google trả 500, 502/503, 504 hoặc trang “Google Tài liệu đã gặp lỗi” trước bước Gửi. | Nhận diện lỗi được hỗ trợ; retry/phục hồi hữu hạn hoặc dừng rõ ràng; không báo hoàn tất. |
| E08 | P1 | Google trả 429/giới hạn tần suất. | Không refresh dồn dập; chờ có giới hạn/phù hợp phản hồi; các profile khỏe tiếp tục. |
| E09 | P0 | Lỗi dai dẳng hết số lần retry; bấm Stop khi còn timer phục hồi. | Dừng và nêu nguyên nhân; mọi lịch cũ bị hủy, không tự bật lại sau Stop. |
| E10 | P0 | WebSocket extension/manager mất rồi nối lại; ACK trước đó bị mất. | Đối chiếu lệnh/run trước khi tiếp tục; không Start/Gửi trùng; gián đoạn cần xác nhận phải giữ chờ đúng. |
| E11 | P0 | Worker bị suspend/reload hoặc browser crash/mở lại. | Khôi phục journal, đúng snapshot và khóa gửi; không coi lượt cũ chưa từng chạy; không gửi lại tự động. |
| E12 | P0 | Coordinator/server đổi instance giữa lượt; tín hiệu instance cũ đến muộn. | Một chủ điều phối hợp lệ; không có hai bên cấp quyền thực thi/Gửi song song. Chỉ gây lỗi này trên môi trường thử. |

## 7. CAPTCHA và thay đổi phía Google — 6 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| F01 | P0 | CAPTCHA xuất hiện trước khi điền, sau Next hoặc trước Gửi. | Dừng đúng profile để người dùng xử lý; không vượt/bỏ qua, không kéo cả nhóm vào trạng thái chờ. |
| F02 | P0 | CAPTCHA hết hạn hoặc người dùng chưa hoàn tất mà bấm Resume. | Không coi CAPTCHA đã qua; không Next/Gửi khi Google chưa cho phép. |
| F03 | P0 | Câu xác thực thay nội dung, dạng textbox/radio, hoặc xuất hiện sớm hơn. | Không đoán đáp án; nhận diện hoặc dừng câu chưa hỗ trợ; không đưa đáp án cũ sang câu mới. |
| F04 | P0 | Form chưa mở, vừa đóng hoặc hết slot trong lúc chạy. | Hiển thị đúng trạng thái; không lặp tải vô hạn, không báo đăng ký thành công khi Google chưa nhận. |
| F05 | P0 | Tài khoản không được truy cập, form yêu cầu miền khác hoặc đã trả lời một lần. | Phân biệt giới hạn truy cập/đã trả lời với lỗi điền; không đăng ký hộ bằng tài khoản khác. |
| F06 | P0 | Tiêu đề/nhánh/trường bắt buộc thay đổi so với lần diễn tập. | Phát hiện điểm chưa ghép được; dừng đúng profile để xử lý thay vì dùng ánh xạ sai cho kịp thời gian. |

## 8. Gửi và chống gửi trùng — 12 ca

Các ca tự động Gửi và gây mất xác nhận chỉ chạy trên form/máy chủ giả lập do mình kiểm soát. Xác nhận Google thật phải dựa vào bằng chứng thực của Google; log nội bộ “đã click” không đủ.

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| G01 | P0 | Test đến trang cuối, kể cả câu xác thực đã được người dùng điền trong môi trường thử. | Extension không bấm Gửi. Phân biệt Xong Test với Đã được Google nhận. |
| G02 | P0 | Live giả lập bình thường cho cả 5. | Tối đa một lần gửi từ ứng dụng cho mỗi lượt/profile; đánh dấu thành công sau xác nhận máy chủ, không chỉ sau click. |
| G03 | P0 | Bấm hai nút Resume/Start/Restart từ manager và panel gần như cùng lúc ở trang cuối. | Một quyền Gửi hợp lệ; không có hai click Submit từ các đường điều khiển cạnh tranh. |
| G04 | P0 | Cấp khóa Gửi rồi đóng tab/mất mạng trước khi biết click có xảy ra hay chưa. | Giữ trạng thái chưa rõ; không tự bỏ khóa để thử tiếp. |
| G05 | P0 | Máy chủ đã nhận nhưng trả 500, mất kết nối hoặc không hiển thị trang cảm ơn. | Submit uncertain; không gửi lại tự động. Cần đối chiếu bằng chứng trước mọi quyết định tiếp theo. |
| G06 | P0 | Google từ chối vì một trường lỗi sau thao tác Gửi. | Không báo thành công. Phân biệt bị từ chối rõ ràng với chưa rõ đã nhận; sửa/gửi lại chỉ theo cơ chế có bằng chứng đã kiểm thử. |
| G07 | P0 | Reload/đóng mở browser sau một lần Gửi chưa rõ kết quả. | Khóa gửi và trạng thái chưa rõ còn nguyên; không reload POST và tự gửi thêm. |
| G08 | P0 | Sau xác nhận đã nhận, thử Resume/Restart và lệnh Start cũ. | Không gửi trùng trong phạm vi khóa được thiết kế; kết quả cũ không bị lệnh muộn hạ cấp. |
| G09 | P0 | Người dùng tự bấm Gửi trên form khi ứng dụng đang chờ/đang chạy. | Không phát thêm lần gửi tự động. Nếu không quan sát được kết quả đủ chắc chắn phải chuyển đối chiếu, không suy đoán chưa gửi. |
| G10 | P0 | Hai tab cùng form trong một Chrome profile, chỉ một tab thuộc run hiện tại. | Không điền/Gửi nhầm tab; không cấp hai quyền do có hai content script. |
| G11 | P0 | Một profile đã có khóa gửi nhưng 4 profile còn lại chưa gửi. | Chặn đúng profile đã khóa; 4 profile còn đủ điều kiện vẫn thực hiện độc lập. |
| G12 | P0 | Nhận ACK thành công/lỗi lặp hoặc đảo thứ tự sau khi đã xác nhận kết quả. | Cập nhật idempotent, không thay một kết quả chắc chắn bằng trạng thái cũ, không nhả khóa nhầm. |

## 9. Tốc độ và điều kiện máy thật — 8 ca

| ID | Mức | Tình huống / thao tác thử | Kết quả bắt buộc |
|---|---|---|---|
| H01 | P1 | Cả 5 Google profile thật, cùng máy dùng ngày đăng ký, nháp trống; 3 lượt diễn tập trên form thử. | Ghi đủ từng profile và thời gian cả nhóm tới xác thực; 0 dữ liệu sai, 0 submit; không lấy tốc độ nháp có sẵn thay cho nháp trống. |
| H02 | P1 | Cả 5 cửa sổ ở nền/thu nhỏ, manager đang foreground ở trình duyệt khác. | Vẫn điền/chuyển trang được; không cần lần lượt mở từng form để đánh thức; thời gian không bị tuần tự theo cửa sổ. |
| H03 | P1 | Tải nền giống ngày thật: tab đang dùng, bộ nhớ thấp, CPU cao ở mức máy vẫn đáp ứng. | Đo thời gian/độ trễ/độ ổn định; không lẫn dữ liệu. Nếu không đạt phải giảm tải trước ngày thật, không suy kết quả máy nhẹ sang máy nặng. |
| H04 | P1 | Mô phỏng trễ 0,5/1,5/3 giây mỗi trang, một profile có Next 22 giây. | Ghi thời gian profile khỏe riêng; không có hàng đợi toàn nhóm, không bỏ kiểm tra để bù tốc độ. |
| H05 | P1 | Test nóng và lạnh: app vừa mở, extension vừa nối lại, Google Picker chưa có cache. | Tách thời gian chuẩn bị khỏi thời gian điền nhưng vẫn báo tổng end-to-end; không chỉ chọn mẫu đẹp nhất. |
| H06 | P0 | Chạy sát các mốc mở form: trước mở, vừa mở, +45 giây, +60 giây, +120 giây trên fixture có lịch đóng. | Chỉ gửi khi form thật sự cho phép; xử lý đóng/hết slot đúng; không tự coi một click muộn là đã đăng ký được. |
| H07 | P0 | Máy khóa/ngủ, mất nguồn hoặc browser bị hệ điều hành dừng giữa lượt. | Sau trở lại phải đối chiếu dữ liệu và khóa gửi; không tự gửi lại lượt chưa rõ. Không coi kết quả khi máy luôn thức là bằng chứng cho ca này. |
| H08 | P1 | Đối chiếu đồng hồ UI, server Start và thời điểm tới xác thực/Gửi. | Ghi rõ nguồn mốc đo; không làm thời gian tăng sai khi chỉ reconnect/đóng tab, không trừ mất thời gian mở form, không gộp chờ người vào tốc độ autofill. |

## 10. Ma trận gây lỗi theo giai đoạn

Một ca “mất mạng” ở đầu form không chứng minh an toàn khi mất mạng lúc Gửi. Với các ca E/G, tối thiểu phải đánh dấu giai đoạn thực sự đã thử:

| Giai đoạn | Sự cố cần đặt vào | Bất biến cần giữ |
|---|---|---|
| Trước khi nhận Start | Mất kết nối, Start lặp, profile không đủ điều kiện | Không có lượt thực thi ngoài ý muốn; profile khỏe không đợi profile lỗi. |
| Đang điền | Reload, Pause/Stop, thay hồ sơ, DOM reset | Đúng snapshot; không có ghi muộn sau Stop; không Next sai. |
| Đang mở Picker/upload | Mạng đứt, tệp lỗi, đóng Picker, reload | Không lẫn ảnh; xác nhận trên document hiện tại; không skip mù. |
| Sau Next chưa thấy trang mới | POST treo, phản hồi muộn, 500/429, reload | Không Next trùng; phục hồi hữu hạn khi an toàn. |
| Đang chờ người dùng | Sửa tay, đổi tài khoản, CAPTCHA hết hạn, back/reload | Không tự vượt xác thực; giữ trạng thái và yêu cầu đối chiếu đúng. |
| Đã cấp quyền/đã click Gửi | Mạng đứt, crash, response mất, ACK muộn | Giữ khóa; phân biệt chưa rõ với bị từ chối/đã nhận; không retry mù. |
| Đã được xác nhận nhận | Start/Restart/Resume lặp, reconnect, ACK cũ | Không gửi thêm và không mất kết quả đã xác nhận. |

## 11. Tiêu chí chốt trước buổi thật

1. **5/5 profile thật** đã được liên kết, xác nhận email Google, đối chiếu hồ sơ và nội dung ảnh. Có người kiểm tra bảng chuẩn lần cuối; không sửa dữ liệu sát giờ mà không kiểm tra lại.
2. Các P0 liên quan luồng sử dụng đã đạt và có bằng chứng trên đúng build. Nếu chưa chạy hoặc không tái hiện được phải ghi rõ; không đổi thành Đạt để chốt lịch.
3. Chạy **3 lượt Google Test từ nháp trống với đủ 5 profile**, không gửi. Ghi min/trung vị/max từng profile và thời gian profile cuối cùng tới xác thực. Đây vẫn là mẫu nhỏ, không bảo đảm điều kiện đông người.
4. Mục tiêu mong muốn 15–20 giây giữ nguyên. Ngưỡng diễn tập đề xuất cần xem xét là **cả 5 tới xác thực trước 45 giây trong điều kiện bình thường**; đây là ngưỡng nghiệm thu hiệu năng đề xuất, không phải cam kết khi Google quá tải. Mọi lượt sai dữ liệu đều trượt dù nhanh.
5. Tối thiểu diễn tập các tổ hợp C07, D03/D04/D07, E04/E05/E10/E11 và G04/G05/G07. Gửi/mất xác nhận được thử trên fixture có bộ đếm phía nhận.
6. Thao tác manager và panel trên **bản cài thật** đã được đối chiếu. Test panel trên fixture không thay thế việc xác nhận panel thực tế nếu ngày thật sẽ điều khiển bằng panel.
7. Ghi rõ ai xử lý profile nào khi cần CAPTCHA/câu xác thực, nơi xem kết quả, và cách đối chiếu khi Submit uncertain. Không bấm Chạy lại hàng loạt vì một profile lỗi.
8. Chốt build đã kiểm thử. Nếu thay code, extension, ảnh, hồ sơ, tài khoản hoặc máy sau nghiệm thu, chạy lại các ca bị ảnh hưởng trước Live.

## 12. Quy tắc quyết định lúc đăng ký thật

- **Chờ câu xác thực/CAPTCHA:** xử lý đúng profile đó; những profile khác tiếp tục theo trạng thái riêng.
- **Sai tài khoản, thiếu dữ liệu, sai ảnh hoặc không biết ghép câu:** dừng profile đó để đối chiếu; không Gửi để chạy kịp giờ.
- **Lỗi điều hướng trước Gửi:** dùng cơ chế phục hồi đã được kiểm thử; xem trạng thái trước khi thao tác lặp. Không reload POST theo phản xạ.
- **Đã cấp khóa Gửi/Submit uncertain:** không Start/Restart/xóa khóa để “thử lại”. Đối chiếu bằng chứng nhận của Google; nếu chưa chứng minh được thì vẫn là chưa rõ.
- **Một profile chậm/lỗi:** ưu tiên giải quyết riêng; không dừng, reload hay thay dữ liệu cả nhóm.
- **Form đóng/hết slot:** ghi đúng kết quả thực tế. Ứng dụng không thể tạo lại slot hoặc bảo đảm vượt qua tình trạng Google đã ngừng nhận.

## 13. Bằng chứng hiện có và phần còn thiếu

Theo báo cáo kiểm chứng ngày 17/10/2026:

- 357 kiểm tra tự động đã qua; 10 Chromium độc lập trên fixture chạy Test và các ca lỗi, có Live giả lập kiểm tra đúng một lần.
- Google thật đã thử **2 profile**, tới xác thực từ nháp trống sau **25,735/27,335 giây**. Chạy lại riêng và phục hồi sau trang lỗi Google cũng đã quan sát được.
- **Chưa có 3 lượt từ nháp trống trên đủ 5 Google profile thật.** Chưa chứng minh tốc độ/độ ổn định vào thời điểm mở đăng ký đông người.
- Panel extension đã test trên fixture; chưa hoàn tất đối chiếu panel của bản cài người dùng trong lượt kiểm chứng này.
- Đồng hồ execution trên UI bắt đầu muộn hơn server Start; không dùng nó làm benchmark end-to-end. H08 cần được nghiệm thu riêng, nhất là sau reconnect/đóng tab.
- Những bằng chứng trên không có nghĩa cả 84 ca trong tài liệu mới đã đạt. Ghi kết quả từng ca trước khi quyết định dùng Live.

Báo cáo gốc: `test-results/v150-verification.md`. Tài liệu này chỉ bổ sung kế hoạch kiểm thử; không thay đổi code, không chạy đăng ký và không deploy thêm.
