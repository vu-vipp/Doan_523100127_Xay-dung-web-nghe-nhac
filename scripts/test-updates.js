// Dependency-free regression checks. Does not connect to or modify your MySQL database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function render(template, data) {
  const file = path.resolve(root, 'views', template);
  const src = fs.readFileSync(file, 'utf8');
  let code = 'let output = ""; with (locals) {\n';
  for (const token of src.split(/(<%[\s\S]*?%>)/g)) {
    if (!token) continue;
    if (token.startsWith('<%') && token.endsWith('%>')) {
      const kind = token[2];
      const body = token.slice(kind === '=' || kind === '-' ? 3 : 2, -2);
      code += kind === '=' || kind === '-' ? `output += (${body});\n` : `${body}\n`;
    } else code += `output += ${JSON.stringify(token)};\n`;
  }
  code += '} return output;';
  // Render representative pages using a small EJS-compatible subset (not a full EJS replacement).
  const compiled = new Function('locals', 'include', code);
  const include = (name, extra = {}) => render(path.relative(path.join(root, 'views'), path.resolve(path.dirname(file), name + '.ejs')), { ...data, ...extra });
  return compiled(data, include);
}

(async () => {
  const fake = { query: async () => [ [] ], execute: async () => [ [{ total: 6 }] ] };
  const dbPath = require.resolve('../config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
  const authPath = require.resolve('../middleware/auth');
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true,
    exports: { flash(req, message, type) { req.flash = { message, type }; } } };
  const Song = require('../models/SongModel');
  const Playlist = require('../models/PlaylistModel');
  const PlaylistController = require('../controllers/PlaylistController');
  const SongController = require('../controllers/SongController');
  const AdminController = require('../controllers/AdminController');

  // SQL filter must operate at database level, before the LIMIT, not just on visible 200 songs.
  for (const choice of ['VIP', 'FREE', 'ALL']) {
    let sql = '', args = [];
    fake.query = async (query, parameters) => { sql = query; args = parameters; return [[]]; };
    await Song.list({type: choice, limit: 200});
    if (choice === 'VIP') assert.match(sql,/b\.IsVIP = 1/);
    else if (choice === 'FREE') assert.match(sql,/b\.IsVIP = 0/);
    else { assert.ok(!sql.includes('b.IsVIP = 1')); assert.ok(!sql.includes('b.IsVIP = 0')); }
    assert.match(sql,/b\.TrangThai = 1/);
    assert.equal(args.at(-1), 200);
  }
  let countQuery;
  fake.execute = async (query, args) => { countQuery = { query, args }; return [[{total: 17}]]; };
  assert.equal(await Song.count('VIP'),17);
  assert.match(countQuery.query,/IsVIP=1/);
  assert.equal(await Song.count(),17);
  assert.match(countQuery.query,/TrangThai=1/);

  // Atomic insert must require MaNguoiDung ownership, using the unchanged junction table.
  fake.execute = async (query, args) => {
    assert.match(query, /INSERT IGNORE INTO ChiTietPlaylist/);
    assert.match(query, /p\.MaNguoiDung=\?/);
    assert.deepEqual(args,[9,3,7]);
    return [{affectedRows:1}];
  };
  assert.equal(await Playlist.add(3,7,9),1);

  // Controller follows chosen playlist, checks ownership, detects duplicates, and returns to song.
  const originalOwn = Playlist.own, originalAdd = Playlist.add;
  Playlist.own = async (playlistId,userId) => playlistId === 3 && userId === 7 ? { MaPlaylist:3,TenPlaylist:'Nhạc chill' }: null;
  let addCount = 0;
  Playlist.add = async () => { addCount++; return addCount === 1 ? 1 : 0; };
  const req = { params: {id:'9'}, body:{playlistId:'3'}, user:{MaNguoiDung:7} };
  const res = { redirects:[], redirect(url){this.redirects.push(url);return this;},sendStatus(code){this.code=code;return this;} };
  const next = err => { throw err; };
  await PlaylistController.addFromSong(req,res,next);
  assert.equal(req.flash.type,'success');
  assert.equal(res.redirects.at(-1),'/songs/9');
  await PlaylistController.addFromSong(req,res,next);
  assert.equal(req.flash.type,'warning');
  req.body.playlistId = '4';
  await PlaylistController.addFromSong(req,res,next);
  assert.equal(addCount,2,'Cannot add to playlist owned by someone else');
  assert.match(req.flash.message,/không thuộc/);
  Playlist.own = originalOwn; Playlist.add = originalAdd;

  // Verify administrator role and invalid filters become safe defaults.
  const prevList=Song.list, prevCount=Song.count;
  Song.list = async opts => [{MaBaiHat:1,IsVIP:opts.type==='VIP'?1:0,TrangThai:1, TenBaiHat:'Demo',TenCaSi:'Studio', LuotNghe:0}];
  Song.count = async (type='ALL') => type==='ALL'?6:2;
  const VIP=require('../models/VIPModel');
  VIP.pending=async()=>[];
  let rendered=null;
  const response={render(t,props){rendered={t,props};}};
  await AdminController.dashboard({query:{type:'VIP'}},response,next);
  assert.equal(rendered.props.filter,'VIP');
  assert.equal(rendered.props.filteredCount,2);
  assert.equal(rendered.props.totalSongs,6);
  await AdminController.dashboard({query:{type:'UNTRUSTED'}},response,next);
  assert.equal(rendered.props.filter,'ALL');
  const prevGenres=Song.genres;
  Song.genres=async()=>[];
  await AdminController.musicLibrary({query:{q:'demo',genre:'1',type:'VIP'}},response,next);
  assert.equal(rendered.t,'songs/index');
  assert.equal(rendered.props.adminLibrary,true);
  assert.equal(rendered.props.filter,'VIP');
  assert.equal(rendered.props.search,'demo');
  assert.equal(rendered.props.genre,'1');
  const prevFind=Song.find;
  Song.find=async () => ({MaBaiHat:8,TenBaiHat:'Demo VIP',IsVIP:1,TrangThai:1,TenCaSi:'Studio',TenTheLoai:'Pop'});
  await AdminController.musicPreview({params:{id:'8'}},response,next);
  assert.equal(rendered.t,'songs/detail');
  assert.equal(rendered.props.adminPreview,true);
  Song.find=prevFind;
  Song.genres=prevGenres;
  Song.list=prevList; Song.count=prevCount;

  // A non-VIP listener must be denied at the streaming endpoint, but Admin
  // must be able to review the same VIP audio without an active subscription.
  const streamFind=Song.find, streamCounter=Song.increasePlays;
  Song.find=async () => ({MaBaiHat:5,IsVIP:1,TrangThai:1,DuongDanAudio:'demo-vip-dem-sao.wav'});
  Song.increasePlays=async () => {};
  const forbidden={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await SongController.stream({params:{id:'5'},headers:{},user:{MaNguoiDung:9,VaiTro:'USER'},activeVIP:null},forbidden,next);
  assert.equal(forbidden.statusCode,403);
  assert.match(forbidden.body.error,/VIP/);
  const {Writable}=require('node:stream');
  class ResponseSink extends Writable {
    constructor(){super();this.statusCode=200;this.headers={};this.bytes=0;}
    status(code){this.statusCode=code;return this;}
    set(name,value){
      if(typeof name==='object') Object.assign(this.headers,name);
      else this.headers[name]=value;
      return this;
    }
    sendStatus(code){this.statusCode=code;this.end();return this;}
    _write(buffer,encoding,callback){this.bytes+=buffer.length;callback();}
  }
  const permitted=new ResponseSink();
  const finished=require('node:stream/promises').finished(permitted);
  await SongController.stream({params:{id:'5'},headers:{range:'bytes=0-15'},user:{MaNguoiDung:1,VaiTro:'ADMIN'},activeVIP:null},permitted,next);
  await finished;
  assert.equal(permitted.statusCode,206);
  assert.equal(permitted.bytes,16);
  assert.equal(permitted.headers['Content-Type'],'audio/wav');
  Song.find=streamFind; Song.increasePlays=streamCounter;

  // Ensure no old 'add song' controls remain on playlist detail.
  const playlistView=fs.readFileSync(path.join(root,'views/playlists/detail.ejs'),'utf8');
  assert.ok(!playlistView.includes('Thêm bài hát vào playlist'));
  assert.ok(!playlistView.includes('/playlists/<%= playlist.MaPlaylist %>/add'));
  assert.ok(playlistView.includes('/remove-song'));
  const songView=fs.readFileSync(path.join(root,'views/songs/detail.ejs'),'utf8');
  assert.ok(songView.includes('＋ Thêm vào playlist'));
  assert.ok(songView.includes('/songs/<%= song.MaBaiHat %>/playlist'));
  const header=fs.readFileSync(path.join(root,'views/partials/header.ejs'),'utf8');
  assert.ok(header.includes('if(adminOnly)'));
  assert.ok(header.includes('href="/admin/music"'));
  const appJs=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8');
  assert.match(appJs,/main\.replaceChildren\(/);
  assert.match(appJs,/window\.addEventListener\('popstate'/);
  assert.match(appJs,/document\.addEventListener\('click'/);
  assert.match(appJs,/pendingNavigation\?\.abort\(\)/);

  const common = {title:'Demo',csrfToken:'TOKEN',flash:null,viewer:{MaNguoiDung:7,HoTen:'Tester',VaiTro:'USER'},activeVIP:null,
    formatDuration: ()=>'0:16',formatPrice:()=> '0 ₫'};
  // Syntax compile ALL 14 EJS files, even forms/errors not rendered during this test.
  let templates=0;
  function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const dest=path.join(dir,entry.name);
    if(entry.isDirectory())scan(dest);
    else if(entry.name.endsWith('.ejs')){
      const src=fs.readFileSync(dest,'utf8');
      let code='let output=""; with (locals) {\n';
      for(const part of src.split(/(<%[\s\S]*?%>)/g)){
        if(!part)continue;
        if(part.startsWith('<%')){
          const kind=part[2],body=part.slice(kind==='='||kind==='-'?3:2,-2);
          code += kind==='='||kind==='-'?`output += (${body});\n`:`${body}\n`;
        } else code += `output += ${JSON.stringify(part)};\n`;
      }
      new Function('locals','include',code+'} return output;');templates++;
    }
  }}
  scan(path.join(root,'views'));
  const song = {MaBaiHat:9,TenBaiHat:'Bài thử',IsVIP:0,TrangThai:1,TenCaSi:'Studio',TenTheLoai:'Instrumental',ThoiLuong:16,LuotNghe:0,AnhBia:null};
  const output = render('songs/detail.ejs',{...common,song,adminPreview:false,playlists:[{MaPlaylist:3,TenPlaylist:'Nhạc chill',SoBaiHat:1}]});
  assert.match(output,/Thêm vào playlist/);
  assert.match(output,/name="playlistId"/);
  const listOutput=render('playlists/detail.ejs',{...common,playlist:{MaPlaylist:3,TenPlaylist:'Nhạc chill'},songs:[]});
  assert.ok(!listOutput.includes('Thêm bài hát vào playlist'));
  const adminOutput=render('admin/index.ejs',{...common,viewer:{...common.viewer,VaiTro:'ADMIN'},songs:[],pending:[],totalSongs:6,filteredCount:2,filter:'VIP'});
  assert.match(adminOutput,/Tất cả/);
  assert.match(adminOutput,/Miễn phí/);
  assert.ok(!adminOutput.includes('href="/songs" class="nav-link"'));
  assert.ok(adminOutput.includes('id="audio-player"'));
  assert.ok(adminOutput.includes('href="/admin/music"'));
  assert.ok(adminOutput.includes('HỆ THỐNG QUẢN TRỊ'));
  const adminLibraryOutput=render('songs/index.ejs',{...common,viewer:{...common.viewer,VaiTro:'ADMIN'},adminLibrary:true,filter:'VIP',search:'',genre:'',genres:[],songs:[]});
  assert.match(adminLibraryOutput,/Bài hát – Nghe thử/);
  assert.match(adminLibraryOutput,/action="\/admin\/music"/);
  const adminPreviewOutput=render('songs/detail.ejs',{...common,viewer:{...common.viewer,VaiTro:'ADMIN'},adminPreview:true,song,playlists:[]});
  assert.match(adminPreviewOutput,/Nghe thử bài hát/);
  assert.ok(!adminPreviewOutput.includes('Đây là bài hát VIP. Bạn cần đăng ký'));
  const songControllerSource=fs.readFileSync(path.join(root,'controllers/SongController.js'),'utf8');
  assert.match(songControllerSource,/req\.user\?\.VaiTro !== 'ADMIN'/);
  const routes=fs.readFileSync(path.join(root,'routes/adminRoutes.js'),'utf8');
  assert.match(routes,/r\.get\('\/admin\/music'/);
  assert.match(routes,/r\.get\('\/admin\/music\/:id'/);
  // Soft Delete must update TrangThai instead of DELETE.
  let deleteSql='';
  fake.execute=async (query,args)=>{deleteSql=query;return [{affectedRows:1}];};
  assert.equal(await Song.remove(9),1);
  assert.match(deleteSql,/UPDATE BaiHat SET TrangThai=0/);
  assert.ok(!/DELETE FROM BaiHat/i.test(deleteSql));
  // Restore must reactivate a previously hidden song.
  let restoreSql='';
  fake.execute=async (query,args)=>{restoreSql=query;return [{affectedRows:1}];};
  assert.equal(await Song.restore(9),1);
  assert.match(restoreSql,/UPDATE BaiHat SET TrangThai=1/);
  assert.match(routes,/\/admin\/songs\/:id\/restore/);
  const adminView=fs.readFileSync(path.join(root,'views/admin/index.ejs'),'utf8');
  assert.match(adminView,/Mở khóa/);
  // VIP checkout must pass through the payment demo before a pending registration is created.
  const vipRoutes=fs.readFileSync(path.join(root,'routes/vipRoutes.js'),'utf8');
  assert.match(vipRoutes,/\/vip\/payment/);
  assert.match(vipRoutes,/confirmPayment/);
  const paymentOutput=render('vip/payment.ejs',{...common,plan:{MaGoi:2,TenGoi:'VIP Plus',ThoiHan:30,Gia:49000},paymentRef:'WAVE VIP U7 G2',demoBank:{name:'WAVE Demo Bank',account:'0000 1234 5678',holder:'WAVE MUSIC DEMO'}});
  assert.match(paymentOutput,/Cổng thanh toán WAVE VIP/);
  assert.match(paymentOutput,/QR MÔ PHỎNG/);
  assert.match(paymentOutput,/Xác nhận đã thanh toán/);
  assert.match(paymentOutput,/BANK_TRANSFER/);
  assert.match(paymentOutput,/BANK_CARD/);
  assert.ok(!/name="(?:cardNumber|cvv|otp)"/i.test(paymentOutput));
  assert.match(adminView,/Đã báo thanh toán/);
  console.log(`PASS: IsVIP/TrangThai filters + Soft Delete + playlist security + Admin music/preview + VIP stream security + continuous-navigation architecture + VIP payment demo + ${templates} EJS templates (syntax only).`);
})().catch(error => {console.error(error);process.exitCode=1;});
