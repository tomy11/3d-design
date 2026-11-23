# เชื่อม Assembly Lab Desktop กับ MCP

เปิด Assembly Lab บน macOS และรอให้ Workbench โหลดเสร็จ ตัวแอปให้ MCP client บัญชีเดียวกันเรียกคำสั่งผ่าน stdio และ Unix socket ใน `~/.assembly-lab` เมื่อเปิดหลายหน้าต่างจากหลายโปรเซส MCP จะคุยกับโปรเซสแรกที่เริ่ม bridge สำเร็จ

หลังอัปเดต Build ให้บันทึกงานและปิดแอปเวอร์ชันที่เปิดค้างไว้ก่อนเปิดแอปเวอร์ชันใหม่ จากนั้นเชื่อม MCP client ใหม่เพื่อโหลดรายการเครื่องมือล่าสุด

## ตั้งค่า client แบบ stdio

Build แอปจากโฟลเดอร์โปรเจกต์

```sh
npm install
npm run desktop:build -- --debug
open 'src-tauri/target/debug/bundle/macos/Assembly Lab.app'
```

ตั้ง MCP client ให้เรียกไฟล์ `Contents/MacOS/assembly-lab` ใน bundle ด้วยอาร์กิวเมนต์ `--mcp` ใช้คำสั่งนี้จากโฟลเดอร์โปรเจกต์หากใช้ Codex CLI

```sh
codex mcp add assembly-lab -- "$PWD/src-tauri/target/debug/bundle/macos/Assembly Lab.app/Contents/MacOS/assembly-lab" --mcp
```

เปิดเซสชันใหม่หลังตั้งค่า แล้วลองขอให้ AI อ่านมิติของ flange adapter ใน Assembly Lab

## ตั้งค่า client แบบ Streamable HTTP

เปิด Assembly Lab ตามปกติ แล้วรันคำสั่งต่อไปนี้จากโฟลเดอร์โปรเจกต์เพื่อเปิด MCP HTTP แยกอีกโปรเซส

```sh
export ASSEMBLY_LAB_MCP_TOKEN="$(openssl rand -hex 32)"
"$PWD/src-tauri/target/debug/bundle/macos/Assembly Lab.app/Contents/MacOS/assembly-lab" --mcp-http
```

ตั้ง client หรือ backend ของแอป AI ให้ใช้ **Streamable HTTP** ที่ `http://127.0.0.1:8765/mcp` พร้อม HTTP header `Authorization: Bearer <token>` ใช้ค่าเดียวกับ `ASSEMBLY_LAB_MCP_TOKEN` บน Mac ที่รันแอป ค่า token นี้อนุญาตทั้งการอ่านและการแก้มิติ ให้เก็บไว้ใน secret ของ backend หรือ client ที่เชื่อถือได้ ตั้ง `ASSEMBLY_LAB_MCP_PORT` ก่อนเปิดโปรเซสเพื่อเปลี่ยนพอร์ต และกด `Ctrl+C` เพื่อหยุด HTTP

สำหรับ AI client ที่รันในเครื่องอื่นและเข้าถึง Mac ผ่าน SSH อยู่แล้ว ให้เปิด tunnel จากเครื่อง client แล้วใช้ URL `http://127.0.0.1:8765/mcp` และ token เดิม

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8765:127.0.0.1:8765 <mac-user>@<mac-host>
```

สำหรับแอป AI บนเว็บ ให้เรียก MCP จาก backend ผ่านช่องทางส่วนตัวที่เข้าถึง Mac ได้ เช่น SSH tunnel จาก backend ตัว MCP HTTP ฟังเฉพาะ loopback และรองรับ client ที่ส่ง bearer token โดยไม่มี browser `Origin` header ส่วนบริการ AI ที่ต้องรับ URL สาธารณะหรือใช้ OAuth จะต้องมี HTTPS gateway และการยืนยันตัวตนที่ตรงกับบริการนั้นเพิ่มเติม

## คำสั่ง

- `get_scene` คืนโหมดที่เปิดอยู่ ชิ้นส่วนที่เลือก และรายการวัตถุพร้อม `id`, `parent_id`, ประเภท และสถานะการแสดงผลจริงใน Viewport เช่น ชิ้นส่วน UR10e, flange adapter, สถานี Pick & Place และชุดมอเตอร์ เฟือง สายไฟใน Service Mode โครงสร้างแม่–ลูกอิงรายการชิ้นส่วนใน Workbench และชิ้นส่วน Service Mode ระบุว่าเป็นแบบจำลองแนวคิด
- `get_robot_pose` คืนเฟรมปัจจุบัน มุมและขีดจำกัด J1–J6 เป็นองศา รวมถึง TCP ในพิกัดฐานแขนกล ตำแหน่งเป็นมิลลิเมตรและมุมเป็นองศา ทั้งสองเวกเตอร์เรียง X, Y, Z โดยมุมใช้ Euler order `ZYX` โหมด Pick & Place รายงาน `gripper_tcp` ส่วนโหมดอื่นรายงาน `tool0` ค่าเหล่านี้มาจากแบบจำลองที่เปิดอยู่
- `get_body` รับ `id` แบบไม่บังคับ ค่าเริ่มต้นคือ `flange-adapter` ผลลัพธ์มีมิติ หน่วย `mm` ค่า `revision` และ `project_id` ของโปรเจกต์ที่เปิดอยู่ ค่า `project_id` เปลี่ยนเมื่อเปิดไฟล์โปรเจกต์ใหม่หรือเปิดแอปใหม่
- `set_adapter_dimensions` รับ `id`, `project_id` และ `expected_revision` จากผลของ `get_body` พร้อม `dimensions` ที่ระบุเฉพาะค่าที่จะแก้ เช่น `{"thickness":18}` เปิด **CAD → Flange adapter** เพื่อดูผลและส่งออก STEP การแก้ที่สำเร็จย้อนกลับได้ด้วย Undo หนึ่งครั้ง

`get_scene` และ `get_robot_pose` ใช้ revision ของรายการแก้ไขที่เข้าประวัติและการปรับมุมข้อต่อโดยตรง การเลื่อนเฟรมหรือเปลี่ยนมุมกล้องใช้ revision เดิม ส่วน `get_body` ใช้ revision ของอะแดปเตอร์สำหรับส่งให้ `set_adapter_dimensions`

หากได้ `APP_UNAVAILABLE` ให้เปิดแอปเดสก์ท็อป หากได้ `APP_STARTING` ให้รอ Workbench โหลดเสร็จแล้วลองอ่านอีกครั้ง

หากได้ `REVISION_CONFLICT` หรือ `PROJECT_CONFLICT` ให้เรียก `get_body` ใหม่แล้วตรวจมิติกับโปรเจกต์ก่อนแก้อีกครั้ง
