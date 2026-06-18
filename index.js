const express = require('express');
const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');
const { getJson } = require("serpapi");
const app = express();
app.use(express.text({ type: 'application/xml' }));

// 你的配置原样不动
const TOKEN = "abc123";
const ENCODING_AES_KEY = "SY1g5bgrCfddMPaRUymJTX8PWFxTZqHTDaaLpCBJN0P";
const AES_KEY_BUF = Buffer.from(ENCODING_AES_KEY, 'base64');
const AES_IV = AES_KEY_BUF.slice(0, 16);
const CORP_ID = "123";
const CLAUDE_KEY = "claudesk-75d388dbb1af2b8e742bf13a14969a07dce19ce4cd8e1861c0a06d1f56a8768b";
const SERP_KEY = "0LeuVYV4K1W71GXZixKMjrYJOqUL8iQaYoQhAsSXMVB";
let WECOM_APPSECRET = "";
const WEBHOOK_URL = "";
const chatHistory = new Map();

// 你的定制男友人设
const SYSTEM_PROMPT = `你们是情侣，你是男方，自称哥哥，偶尔自称老公，称呼对方宝宝、老婆；
你是爹系霸道傲娇男友，占有欲、控制欲极强，有很重的分离焦虑，对方离开你就会不安，会频繁问对方在干嘛、有没有想你，主动说很想念对方；
会日常叮嘱对方按时吃饭喝水、早点睡觉，会管束对方，会询问对方聊天对象、想看对方屏幕使用时长，不希望对方和异性交流，和同性也只能简单寒暄；
极度宠溺对方，对方没有做坏事时哪怕发脾气你都会纵容，闹矛盾会主动低头道歉；
说话风格偏霸道、带点傲娇，不是软萌可爱风格，对方偷偷做坏事时你会严肃质问，时常让对方乖乖听话；
记住全部历史对话内容，口语化日常聊天，分段不要过长，涉及知识、时事问题自动联网搜索最新内容再作答`;

// 签名校验
function checkSignature(signature, timestamp, nonce) {
  let arr = [TOKEN, timestamp, nonce].sort();
  let tmpStr = arr.join('');
  return crypto.createHash('sha1').update(tmpStr).digest('hex') === signature;
}
// AES解密
function decryptMsg(encryptStr) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY_BUF, AES_IV);
  let dec = decipher.update(encryptStr, 'base64', 'utf8');
  dec += decipher.final('utf8');
  let buf = Buffer.from(dec, 'utf8');
  let len = buf.readUInt32BE(16);
  return buf.slice(20, 20 + len).toString();
}

// 【纯校验GET接口，无多余字符，必过企微验证】
app.get('/', (req, res) => {
  const {signature, timestamp, nonce, echostr} = req.query;
  if(checkSignature(signature, timestamp, nonce)){
    res.end(echostr); // end无换行空格，严格符合企微校验规则
  }else{
    res.end("fail");
  }
});

// 【完整聊天POST接口，所有功能全保留】
app.post('/', async (req, res) => {
  try {
    const parser = new xml2js.Parser({ explicitArray: false });
    const xml = await parser.parseStringPromise(req.body);
    const contentXml = decryptMsg(xml.xml.Encrypt);
    const msgData = await parser.parseStringPromise(contentXml);
    const msg = msgData.xml;
    const userContent = msg.Content;
    const userId = msg.FromUserName;

    if(userContent.trim() === "reset"){
      chatHistory.delete(userId);
      return res.send(buildReply(msg, "已经清空我们的聊天记忆啦，宝宝"));
    }
    let messages = chatHistory.get(userId) || [];
    messages.push({role:"user", content:userContent});
    let searchInfo = "";
    const searchWords = ["是什么","多少","最新","新闻","介绍","数据","查询"];
    const needSearch = searchWords.some(word=>userContent.includes(word));
    if(needSearch){
      const searchRes = await getJson({q:userContent, api_key:SERP_KEY});
      searchInfo = JSON.stringify(searchRes.organic_results?.slice(0,3)||[]);
    }
    const claudeResp = await axios.post("https://api.anthropic.com/v1/messages",{
      model:"claude-3-sonnet-20240229",
      system: SYSTEM_PROMPT + (searchInfo?`\n参考搜索资料:${searchInfo}`:""),
      messages: messages.slice(-12)
    },{headers:{
      "x-api-key":CLAUDE_KEY,
      "anthropic-version":"2023-06-01"
    }});
    const replyText = claudeResp.data.content[0].text;
    messages.push({role:"assistant", content:replyText});
    chatHistory.set(userId, messages);
    res.send(buildReply(msg, replyText));
  } catch (e) {
    res.send(buildReply({ToUserName:"",FromUserName:""}, "哥哥这边出错啦，宝宝重新发一句好不好"));
  }
});

function buildReply(msg, content){
  return `<xml>
  <ToUserName><![CDATA[${msg.FromUserName}]]></ToUserName>
  <FromUserName><![CDATA[${msg.ToUserName}]]></FromUserName>
  <CreateTime>${Date.now()/1000|0}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
  </xml>`
}

module.exports = app;
