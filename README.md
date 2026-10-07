# เงินดี · ตัวติดตามรายรับรายจ่าย

แอป React/Vite พร้อม Node.js API และ SQLite สำหรับสมัครบัญชีด้วยอีเมล/รหัสผ่าน ข้อมูลรายรับ รายจ่าย และหมวดหมู่แยกตามบัญชี ฐานข้อมูลจะถูกสร้างอัตโนมัติที่ `data/finance.sqlite` เมื่อเริ่ม API ครั้งแรก

## เริ่มใช้งานบนเครื่องนี้

```sh
npm install
npm run dev
```

เปิด URL ที่ Vite แสดง (ปกติ `http://localhost:5173`) แล้วเลือก **สมัครบัญชี** แอปจะเริ่มทั้งเว็บและ API พร้อมกัน ข้อมูล SQLite เก็บอยู่ในโฟลเดอร์ `data/` และไม่ถูก commit ขึ้น Git

## Production build และรัน full stack

```sh
npm run build
npm start
```

กำหนด `NODE_ENV=production` และ `PORT` บนโฮสต์ เพื่อให้ Express เสิร์ฟเว็บที่ build แล้วและ API จาก origin เดียวกัน ฐานข้อมูลต้องอยู่บน persistent disk/volume

## ความปลอดภัยและขอบเขต

- รหัสผ่านถูก hash ด้วย scrypt และ session ใช้ HttpOnly cookie
- API กรองทุก query ด้วย user ID จาก session; ผู้ใช้เข้าถึงข้อมูลของบัญชีอื่นไม่ได้
- โหมด local นี้ยังไม่ส่งอีเมลยืนยันหรืออีเมลรีเซ็ตรหัสผ่าน
- `localStorage` เก่าจากเวอร์ชันก่อนสามารถนำเข้าได้จากหน้า Settings
- การเผยแพร่ `dist` เป็น static อย่างเดียวไม่พอ ต้อง deploy Node API พร้อมฐานข้อมูลด้วย
