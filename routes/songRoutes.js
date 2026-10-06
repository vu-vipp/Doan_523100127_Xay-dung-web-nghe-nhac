const r=require('express').Router();
const c=require('../controllers/SongController');
r.get('/songs',c.list);
r.get('/songs/:id/stream',c.stream);
r.get('/songs/:id',c.detail);
module.exports=r;
