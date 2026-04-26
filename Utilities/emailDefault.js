const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

  const settingsPath = path.join(__dirname, 'Settings.json');
  let emailTo = '';
  try {
    const rawData = fs.readFileSync(settingsPath, 'utf8');
    const jsonData = JSON.parse(rawData);
    emailTo = jsonData.EMAIL_TO || '';
  } catch (e) {
    console.error('Failed to read Settings.json for EMAIL_TO:', e.message);
  }
  if (!emailTo) {
    console.error('EMAIL_TO is not configured in Settings.json');
    process.exit(1);
  }

const savePath = path.join(process.env.APPDATA, 'cline-Remote', 'Cases', 'report.html');

const htmlBody = fs.readFileSync(savePath, 'utf8'); // 读取内容

// 发邮件（带 HTML 附件）
const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: 'dvxchen@qq.com',
    pass: 'bmvjzubzfzuxdjdb'
  }
});

transporter.sendMail({
  from: '自动化系统 <dvxchen@qq.com>' ,  // ✅ 正确
  to: emailTo,
  subject: 'JSON 转 HTML 报告',
  html: htmlBody,  // ✅ HTML 直接作为邮件正文
}).then(() => {
  console.log('✅ 发送成功！');
}).catch(console.error);