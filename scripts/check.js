const fs=require('fs');const path=require('path');const cp=require('child_process');
const root=path.resolve(__dirname,'..');
const files=[];
for(const folder of ['config','models','controllers','routes','middleware','public/js','scripts','utils']) {
  const dir=path.join(root,folder);
  fs.readdirSync(dir).filter(f=>f.endsWith('.js')).forEach(f=>files.push(path.join(dir,f)));
}
files.push(path.join(root,'server.js'));
for(const file of files){cp.execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}
console.log(`PASS: cú pháp Node.js hợp lệ cho ${files.length} tệp JavaScript.`);
let ejs;
try{ejs=require('ejs');}catch(err){console.log('Chưa cài npm: bỏ qua kiểm tra EJS. Chạy npm.cmd install rồi npm.cmd run check.');}
let n=0;
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
  const file=path.join(dir,item.name);
  if(item.isDirectory())walk(file);else if(file.endsWith('.ejs')){if(ejs)ejs.compile(fs.readFileSync(file,'utf8'),{filename:file});n++;}
}}
walk(path.join(root,'views'));
console.log(ejs?`PASS: cú pháp hợp lệ cho ${n} mẫu giao diện EJS.`:`INFO: đếm đủ ${n} file EJS, chưa compile do thiếu npm dependencies.`);
const sql=fs.readFileSync(path.join(root,'database/schema.sql'),'utf8');
const names=[...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
const expected=['NguoiDung','CaSi','TheLoai','Album','BaiHat','Playlist','ChiTietPlaylist','GoiVIP','DangKyVIP'];
if(JSON.stringify(names)!==JSON.stringify(expected))throw new Error('Danh sách bảng sai so với thiết kế CP3.');
console.log('PASS: schema.sql chứa chính xác 9 bảng có tên khớp CP3.');
