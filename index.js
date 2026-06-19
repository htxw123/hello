const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.text({type:'application/xml'}))

const TOKEN = "abc123"
const AES_KEY_STR = "SY1g5bgrCfddMPaRUymJTX8PWFxTZqHTDaaLpCBJN0P"
const keyBuf = Buffer.from(AES_KEY_STR, 'base64')
const iv = keyBuf.slice(0,16)

// 签名校验
function checkSign(signature,timestamp,nonce){
  const arr = [TOKEN,timestamp,nonce].sort()
  return crypto.createHash('sha1').update(arr.join('')).digest('hex') === signature
}

// AES解密
function decrypt(enc){
  const dec = crypto.createDecipheriv('aes-256-cbc',keyBuf,iv)
  let s = dec.update(enc,'base64','binary')
  s += dec.final('binary')
  const buf = Buffer.from(s,'binary')
  const len = buf.readUInt32BE(16)
  return buf.slice(20,20+len).toString()
}

app.get('/',(req,res)=>{
  const {signature,timestamp,nonce,echostr} = req.query
  if(checkSign(signature,timestamp,nonce)) res.end(echostr)
  else res.end('fail')
})

app.post('/',(req,res)=>{
  res.end('ok')
})
module.exports = app
