const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname,'..','storage','audio');
const sampleRate=22050;
const tracks=[
  {file:'demo-binh-minh.wav',notes:[261.63,329.63,392,523.25,392,329.63,293.66,261.63]},
  {file:'demo-mua-dem.wav',notes:[220,261.63,329.63,293.66,261.63,196,220,174.61]},
  {file:'demo-pho-xa.wav',notes:[329.63,392,440,493.88,440,392,329.63,293.66]},
  {file:'demo-may-bay.wav',notes:[174.61,220,261.63,349.23,329.63,261.63,220,196]},
  {file:'demo-vip-dai-duong.wav',notes:[196,246.94,293.66,392,369.99,293.66,246.94,196]},
  {file:'demo-vip-dem-sao.wav',notes:[261.63,311.13,392,466.16,392,311.13,293.66,261.63]}
];
function writeWav(track) {
  const out=path.join(OUT,track.file);
  if(fs.existsSync(out)) return;
  const seconds=16,samples=sampleRate*seconds;
  const pcm=Buffer.allocUnsafe(samples*2);
  for(let i=0;i<samples;i++) {
    const t=i/sampleRate;
    const section=Math.min(track.notes.length-1,Math.floor(t/2));
    const local=t-section*2, freq=track.notes[section];
    const envelope=Math.min(1,local/.04)*Math.min(1,(2-local)/.33);
    const fade=Math.min(1,t/.3)*Math.min(1,(seconds-t)/.35);
    const tone=Math.sin(2*Math.PI*freq*t)*.53 + Math.sin(2*Math.PI*freq*2*t)*.14
      +Math.sin(2*Math.PI*freq/2*t)*.16;
    const value=Math.max(-1,Math.min(1,tone*envelope*fade*.57));
    pcm.writeInt16LE(Math.floor(value*32767),i*2);
  }
  const hdr=Buffer.alloc(44);
  hdr.write('RIFF',0);hdr.writeUInt32LE(36+pcm.length,4);hdr.write('WAVE',8);
  hdr.write('fmt ',12);hdr.writeUInt32LE(16,16);hdr.writeUInt16LE(1,20);
  hdr.writeUInt16LE(1,22);hdr.writeUInt32LE(sampleRate,24);
  hdr.writeUInt32LE(sampleRate*2,28);hdr.writeUInt16LE(2,32);hdr.writeUInt16LE(16,34);
  hdr.write('data',36);hdr.writeUInt32LE(pcm.length,40);
  fs.writeFileSync(out,Buffer.concat([hdr,pcm]));
}
function generate(){fs.mkdirSync(OUT,{recursive:true});tracks.forEach(writeWav);return tracks;}
if(require.main===module) {generate();console.log('Đã tạo 6 tệp WAV demo gốc (16 giây/bài).');}
module.exports={generate,tracks};
