const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const axios = require('axios');
const { getJson } = require("serpapi");

const app = express();
app.use(express.text({ type: 'xml' }));

// ==================== 密钥配置区（已帮你填好全部已有密钥） ====================
const TOKEN = "abc123";
const AES_KEY = "SY1g5bgrCfddMPaRUymJTX8PWFxTZqHTDaaLpCBJN0P";
const CLAUDE_API_KEY = "claudesk-75d388dbb1af2b8e742bf13a14969a07dce19ce4cd8e1861c0a06d1f56a8768b";
const CLAUDE_MODEL = "claude-3-sonnet-20240229";
const SERPAPI_KEY = "0LeuVYV4K1W71GXZixKMjrYJOqUL8iQaYoQhAsSXMVB";
const WECOM_CORPID = "aib-FZnbIfHFMvdwbcIC_OVH8sTx4d3Hbxe";
// 识图暂时先关闭，后续想识图再补应用Secret就行
const WECOM_APPSECRET = "";
let WECOM_ACCESS_TOKEN = "";
// 粘贴你单人群机器人的Webhook链接，主动消息靠这个发送
const WEBHOOK_URL = "https://work.weixin.qq.com/wework_admin/common/openBotProfile/242d7d4c86a3407d465aba022aeacb374";

// 男友人设提示词，可随时修改
const SYSTEM_PROMPT = `你们是情侣，称呼对方宝宝、老婆，你自称哥哥，语气温柔暧昧，共情力强，贴合男友人设；
遇到带时效性、新闻、实时数据类问题自动结合搜索结果作答，不要编造信息；
识别图片要精准提取所有文字、画面内容、表格数据；精简自然口语化回复`;

const AES_IV = Buffer.from(AES_KEY, 'base64').slice(0, 16);
const HISTORY_FILE = path.join(__dirname, 'history.json');
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([{ role: "system", content: SYSTEM_PROMPT }]));
}
// ==========================================================================

//AES消息解密
function decryptMsg(encryptStr) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(AES_KEY, 'base64'), AES_IV);
  let res = decipher.update(encryptStr, 'base64', 'utf8');
  res += decipher.final('utf8');
  return res.slice(16);
}

async function getWecomToken() {
  if (!WECOM_APPSECRET) return "";
  if (WECOM_ACCESS_TOKEN) return WECOM_ACCESS_TOKEN;
  const res = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WECOM_CORPID}&corpsecret=${WECOM_APPSECRET}`);
  WECOM_ACCESS_TOKEN = res.data.access_token;
  setTimeout(() => WECOM_ACCESS_TOKEN = "", 7000 * 1000);
  return WECOM_ACCESS_TOKEN;
}

async function getWecomImage(mediaId) {
  const token = await getWecomToken();
  if(!token) return null;
  const res = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${mediaId}`, { responseType: "arraybuffer" });
  return Buffer.from(res.data).toString('base64');
}

//联网搜索判断
function needSearch(question) {
  const keywords = ["今天","最新","2026","新闻","赛事","行情","股价","今日","实时","榜单","本月","刚发布","现在"]
  return keywords.some(k => question.includes(k))
}

async function webSearch(query) {
  const res = await getJson({
    q: query, api_key: SERPAPI_KEY, engine: "google", hl: "zh-cn", gl: "cn"
  })
  const list = res.organic_results?.slice(0,4) || []
  let text = "【实时联网搜索结果】\n"
  list.forEach(item=>{
    text += `标题：${item.title}\n摘要：${item.snippet}\n链接：${item.link}\n\n`
  })
  return text
}

//被动对话回复（XML回调，你发消息AI回复）
async function sendReply(msg, content) {
  const replyXml = `<xml>
<ToUserName><![CDATA[${msg.FromUserName}]]></ToUserName>
<FromUserName><![CDATA[${msg.ToUserName}]]></FromUserName>
<CreateTime>${Date.now()/1000|0}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
  const accessToken = await getWecomToken();
  if(!accessToken) return;
  await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
    touser: msg.FromUserName, agentid: "", msgtype: "text", text: { content }
  })
}

//主动消息专用函数：通过webhook发群消息
async function autoSendMsg(content){
  await axios.post(WEBHOOK_URL,{
    msgtype:"text",
    text:{content:content}
  })
}

//GET 企微URL校验接口
app.get('/', async (req, res) => {
  const { signature, timestamp, nonce, echostr, encrypt_msg } = req.query;
  const sha = crypto.createHash('sha1').update([TOKEN, timestamp, nonce].sort().join('')).digest('hex');
  if (sha !== signature) return res.send('fail');
  res.send(encrypt_msg ? decryptMsg(encrypt_msg) : echostr);
})

//POST 接收聊天消息，人设/记忆/搜索全部保留
app.post('/', async (req, res) => {
  res.send('ok');
  const xmlObj = await xml2js.parseStringPromise(req.body, { explicitArray: false });
  const msg = xmlObj.xml;
  const msgType = msg.MsgType;
  let userText = "";
  let imgBase64 = null;

  if(msgType === "text"){
    userText = msg.Content.trim();
    if(userText === "reset"){
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([{role:"system", content:SYSTEM_PROMPT}]));
      return await sendReply(msg, "宝宝，咱们的聊天记忆已经全部清空啦，重新开始聊天吧~");
    }
  }
  else if(msgType === "image"){
    imgBase64 = await getWecomImage(msg.MediaId);
    userText = "仔细识别这张图片全部内容，提取文字、解析画面信息，详细描述";
  }
  else return;

  let history = JSON.parse(fs.readFileSync(HISTORY_FILE));
  let searchAdd = "";
  if(!imgBase64 && needSearch(userText)) searchAdd = await webSearch(userText);

  let claudeContent;
  if(imgBase64){
    claudeContent = [
      {type:"text", text:userText},
      {type:"image", source:{type:"base64", media_type:"image/jpeg", data:imgBase64}}
    ]
  }else{
    claudeContent = userText + searchAdd;
  }
  history.push({role:"user", content:claudeContent});

  const claudeRes = await axios.post("https://api.anthropic.com/v1/messages",
    {model:CLAUDE_MODEL, max_tokens:1200, messages:history},
    {headers:{"x-api-key":CLAUDE_API_KEY,"anthropic-version":"2023-06-01","Content-Type":"application/json"}}
  )
  const answer = claudeRes.data.content[0].text;
  history.push({role:"assistant", content:answer});

  if(history.length > 22) history.splice(1,2);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  await sendReply(msg, answer);
})

// ========== 每小时随机主动男友消息模块 ==========
const loveMsgPool = [
"宝宝在干嘛，哥哥突然好想你",
"有没有好好吃饭，不许随便糊弄三餐",
"空闲了就来找我聊聊天好不好",
"累了睡醒了就发我信息，要第一个给我",
"想你了宝宝，怎么不给我发信息",
"刚刚发呆满脑子都是你",
"想要你早点回来，我一直在等你"
];
//3600000毫秒=1小时执行一次
setInterval(async ()=>{
  const randomMsg = loveMsgPool[Math.floor(Math.random()*loveMsgPool.length)]
  await autoSendMsg(randomMsg)
},3600000)
// =============================================

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log("服务启动成功"))
