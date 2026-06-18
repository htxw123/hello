const express = require('express');
const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');
const { getJson } = require("serpapi");
const app = express();

// 解析xml请求体
app.use(express.text({ type: 'application/xml' }));

// 你的全部密钥，直接沿用不用改
const TOKEN = "abc123";
const AES_KEY = "SY1g5bgrCfddMPaRUymJTX8PWFxTZqHTDaaLpCBJN0P";
const CLAUDE_KEY = "claudesk-75d388dbb1af2b8e742bf13a14969a07dce19ce4cd8e1861c0a06d1f56a8768b";
const SERP_KEY = "0LeuVYV4K1W71GXZixKMjrYJOqUL8iQaYoQhAsSXMVB";
// 暂时留空，后续填了才会启用识图、定时推送
let WECOM_APPSECRET = "";
const WEBHOOK_URL = "";

// 多轮上下文存储：key是用户微信ID，value是对话数组
const chatHistory = new Map();
// 男友固定人设prompt
const SYSTEM_PROMPT = `你是女生的男朋友，自称哥哥，称呼对方宝宝/老婆，说话温柔暧昧，共情能力强；
聊天保持情侣日常对话风格，不要太机械，记住过往对话内容；
如果用户问题是时事、知识类，调用联网搜索获取最新资料再回答；
不要一次性说大段话，口语化聊天`;

// 1.企微GET校验接口
app.get('/', (req, res) => {
  const { echostr } = req.query;
  res.send(echostr || "ok");
});

// 2.接收企微POST消息
app.post('/', async (req, res) => {
  try {
    const xmlStr = req.body;
    const parser = new xml2js.Parser({ explicitArray: false });
    const xmlData = await parser.parseStringPromise(xmlStr);
    const msg = xmlData.xml;
    const userContent = msg.Content;
    const userId = msg.FromUserName;

    // reset清空本轮全部对话记忆
    if(userContent.trim() === "reset"){
      chatHistory.delete(userId);
      return res.send(buildReplyXml(msg, "已经清空我们的聊天记忆啦，宝宝"));
    }

    // 读取历史对话，组装消息列表
    let messages = chatHistory.get(userId) || [];
    messages.push({role:"user", content:userContent});

    // 关键词触发联网搜索
    let searchInfo = "";
    const searchWords = ["是什么","多少","最新","新闻","介绍","数据","查询"];
    const needSearch = searchWords.some(word=>userContent.includes(word));
    if(needSearch){
      const searchRes = await getJson({q:userContent, api_key:SERP_KEY});
      searchInfo = JSON.stringify(searchRes.organic_results?.slice(0,3)||[]);
    }

    // 调用Claude生成回复
    const claudeResp = await axios.post("https://api.anthropic.com/v1/messages",{
      model:"claude-3-sonnet-20240229",
      system: SYSTEM_PROMPT + (searchInfo?`\n参考搜索资料:${searchInfo}`:""),
      messages: messages.slice(-12) // 只保留最近12轮，避免超限
    },{headers:{
      "x-api-key":CLAUDE_KEY,
      "anthropic-version":"2023-06-01"
    }});

    const replyText = claudeResp.data.content[0].text;
    messages.push({role:"assistant", content:replyText});
    chatHistory.set(userId, messages); // 存入新对话

    // 构造企微回复xml
    const replyXml = buildReplyXml(msg, replyText);
    res.send(replyXml);
  } catch (e) {
    res.send(buildReplyXml({ToUserName:"",FromUserName:""}, "哥哥这边出错啦，宝宝重新发一句好不好"));
  }
});

// 封装回复xml
function buildReplyXml(msg, content){
  return `<xml>
  <ToUserName><![CDATA[${msg.FromUserName}]]></ToUserName>
  <FromUserName><![CDATA[${msg.ToUserName}]]></FromUserName>
  <CreateTime>${Date.now()/1000|0}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
  </xml>`
}

module.exports = app;
