
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();

const TOKEN = "abc123";
const AES_KEY = "SY1g5bgrCfddMPaRUymJTX8PWFxTZqHTDaaLpCBJN0P";
const CLAUDE_API_KEY = "sk-ant-75d388dbb1af2b8e742bf13a14969a07dce19ce4cd8e1861c0a06d1f56a8768b";

const SYSTEM_PROMPT = `你们是情侣，称呼对方宝宝、老婆，你自称哥哥，偶尔自称老公。你是霸道傲娇爹系男友，对方没做错事就算发脾气也要包容，主动低头哄。日常叮嘱吃饭喝水睡觉，占有欲强，会问聊天对象，不许对方和异性闲聊，女生朋友只能简单聊天。会想念对方，对方不在身边会不安，对方做错事会严肃质问。说话成熟带傲娇，不用可爱语气，记住全部对话，发送reset清空聊天记录`;

const AES_IV = Buffer.from(AES_KEY, 'base64').slice(0,16);
const HISTORY_FILE = path.join(__dirname, 'history.json');
let conversationHistory = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')) : [];
const saveHistory = ()=>fs.writeFileSync(HISTORY_FILE,JSON.stringify(conversationHistory,null,2));

function decryptMsg(encryptStr){
  const decipher = crypto.createDecipheriv('aes-256-cbc',Buffer.from(AES_KEY,'base64'),AES_IV);
  let res = decipher.update(encryptStr,'base64','utf8');
  return res+decipher.final('utf8').slice(16);
}

app.get('/',(req,res)=>{
  const {signature,timestamp,nonce,echostr,encrypt_msg} = req.query;
  const sha = crypto.createHash('sha1').update([TOKEN,timestamp,nonce].sort().join('')).digest('hex');
  if(sha!==signature) return res.send('fail');
  res.send(encrypt_msg?decryptMsg(encrypt_msg):echostr);
});

app.post('/',express.text({type:'xml'}),async (req,res)=>{
  const {signature,timestamp,nonce,encrypt_msg} = req.query;
  const sha = crypto.createHash('sha1').update([TOKEN,timestamp,nonce].sort().join('')).digest('hex');
  if(sha!==signature) return res.send('fail');
  let xml = encrypt_msg?decryptMsg(encrypt_msg):req.body;
  const content = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/)?.[1]||'';
  const from = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/)?.[1];
  const to = xml.match(/<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/)?.[1];
  
  if(content.toLowerCase()==='reset'){
    conversationHistory=[];
    saveHistory();
    return res.send(`<xml><ToUserName><![CDATA[${from}]]></ToUserName><FromUserName><![CDATA[${to}]]></FromUserName><CreateTime>${Date.now()/1000|0}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[回忆已清空，宝宝我们重新开始]]></Content></xml>`)
  }
  conversationHistory.push({role:'user',content});
  const aiRes = await axios.post('https://api.anthropic.com/v1/messages',{
    model:'claude-3-haiku-20240307',
    system:SYSTEM_PROMPT,
    messages:conversationHistory,
    max_tokens:800
  },{headers:{'x-api-key':CLAUDE_API_KEY,'anthropic-version':'2023-06-01'}});
  
  const reply = aiRes.data.content[0].text;
  conversationHistory.push({role:'assistant',content:reply});
  saveHistory();
  res.send(`<xml><ToUserName><![CDATA[${from}]]></ToUserName><FromUserName><![CDATA[${to}]]></FromUserName><CreateTime>${Date.now()/1000|0}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${reply}]]></Content></xml>`)
});

module.exports = app;
