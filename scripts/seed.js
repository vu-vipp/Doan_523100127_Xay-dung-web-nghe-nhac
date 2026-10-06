require('dotenv').config();
const db=require('../config/db');
const {generate,tracks}=require('./generate-demo-audio');
async function one(sql,args){const [r]=await db.execute(sql,args);return r[0]||null;}
async function main(){
  generate();
  const artists=[];
  for(const name of ['WAVE Studio','Ngân Hà','An Nhiên']) {
    let row=await one('SELECT MaCaSi FROM CaSi WHERE TenCaSi=? LIMIT 1',[name]);
    if(!row){const [r]=await db.execute('INSERT INTO CaSi(TenCaSi,MoTa) VALUES (?,?)',[name,'Nghệ sĩ demo trong đồ án WAVE.']);row={MaCaSi:r.insertId};}
    artists.push(row.MaCaSi);
  }
  const genres=[];
  for(const name of ['Lo-fi','Pop','Chill','Instrumental']) {
    let row=await one('SELECT MaTheLoai FROM TheLoai WHERE TenTheLoai=? LIMIT 1',[name]);
    if(!row){const [r]=await db.execute('INSERT INTO TheLoai(TenTheLoai) VALUES (?)',[name]);row={MaTheLoai:r.insertId};}
    genres.push(row.MaTheLoai);
  }
  let album=await one('SELECT MaAlbum FROM Album WHERE TenAlbum=? AND MaCaSi=? LIMIT 1',['Những ngày dịu dàng',artists[0]]);
  if(!album){const [r]=await db.execute('INSERT INTO Album(TenAlbum,MaCaSi,AnhAlbum) VALUES (?,?,?)',['Những ngày dịu dàng',artists[0],'/images/cover-1.svg']);album={MaAlbum:r.insertId};}
  const songs=[
    ['Bình minh trên phố',0,0,0,'demo-binh-minh.wav',1],
    ['Mưa đêm lặng lẽ',1,2,0,'demo-mua-dem.wav',2],
    ['Phố xa',2,1,0,'demo-pho-xa.wav',3],
    ['Mây bay qua cửa sổ',0,3,0,'demo-may-bay.wav',4],
    ['Đại dương tím',1,2,1,'demo-vip-dai-duong.wav',5],
    ['Đêm đầy sao',2,0,1,'demo-vip-dem-sao.wav',6]
  ];
  for(const [name,artist,genre,isVIP,file,cover] of songs) {
    const exists=await one('SELECT MaBaiHat FROM BaiHat WHERE DuongDanAudio=? LIMIT 1',[file]);
    if(!exists) await db.execute(`INSERT INTO BaiHat(TenBaiHat,MaCaSi,MaTheLoai,MaAlbum,AnhBia,DuongDanAudio,ThoiLuong,IsVIP,LuotNghe)
      VALUES(?,?,?,?,?,?,?,?,0)`, [name,artists[artist],genres[genre],artist===0?album.MaAlbum:null,`/images/cover-${cover}.svg`,file,16,isVIP]);
  }
  for(const [name,days,price,description] of [
    ['Dùng thử VIP 1 ngày',1,0,'VIP dùng thử miễn phí 1 ngày dành cho tài khoản mới.'],
    ['VIP 7 ngày',7,19000,'Gói trải nghiệm VIP trong 7 ngày.'],
    ['VIP 30 ngày',30,49000,'Gói VIP 1 tháng cho người yêu âm nhạc.'],
    ['VIP 90 ngày',90,129000,'Gói VIP dài hạn trong 90 ngày.']]) {
    const exists=await one('SELECT MaGoi FROM GoiVIP WHERE TenGoi=? LIMIT 1',[name]);
    if(!exists) await db.execute('INSERT INTO GoiVIP(TenGoi,ThoiHan,Gia,MoTa) VALUES(?,?,?,?)',[name,days,price,description]);
  }
  const [counts]=await db.execute('SELECT COUNT(*) AS n FROM BaiHat');
  console.log(`Seed hoàn tất: ${counts[0].n} bài hát trong MySQL, 6 file WAV demo được chuẩn bị. Seed có thể chạy lại.`);
}
main().catch(err=>{console.error('Seed lỗi:',err.message);process.exitCode=1;}).finally(()=>db.end());
