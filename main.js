const { exec } = require('child_process');

const fs = require('fs').promises;
const path = require('path');

const fs0 = require('fs');
const fs1 = require('fs');
const fs2 = require('fs-extra');
const fs3 = require('fs');
const os = require('os');

const { spawn } = require('child_process');
const glob = require('glob'); // 需安装: npm install glob

// 封装：等待单个js执行完毕
function runFile(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path], {
      stdio: 'inherit',
      shell: true
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`文件${path}执行失败`));
    });
  });
}

let allLogs = [];
let caseName = [];
let user1 = [];

(async () => {
  try {

    const dirPath0 = path.join(__dirname, 'Cases');
    const files0 = await fs.readdir(dirPath0);
    try {
      for (const file0 of files0) {
        const dirPath = path.join(__dirname, 'Cases', file0);

        const data1 = require(path.join(dirPath, 'Settings.json'));

        if (data1.Enabled === "true") {
        } else {
          continue
        }


        const files = await fs.readdir(dirPath);
        const jsFiles = files.filter(file => file.endsWith('.js'));

        // 使用 for...of 循环
        for (const file of jsFiles) {

          if (file.indexOf(".json") !== -1) {
            continue
          }

          caseName = file;

          try {  // read .js in current folder

            const filePath = path.join(dirPath, file);
            const content = await fs.readFile(filePath, 'utf8');
            //console.log(`js content read ok: ${file}`);
          } catch (err) {
            console.error('read js file error:', err);
          }

          const dirPath1 = path.join(__dirname, 'Cases', file0, '\\');
          //delete  log.json file in parent folder and current folder
          const filePPath = path.join(__dirname, 'Cases', 'log.json');
          const filePPathAll = path.join(__dirname, 'Cases', 'merged-logs.json');
          const fileCPath = path.join(__dirname, 'Cases', file0, 'log.json');
          const fileRootPath = path.join(__dirname, 'log.json');

          try { // delete log files

            await fs2.remove(filePPathAll);
            await fs2.remove(filePPath);
            await fs2.remove(fileCPath);
            await fs2.remove(fileRootPath);
            //  console.log('清理完成（clear if exist or not）');

          } catch (err) {
            console.error('remove log file error:', err);
          }

          try {
            await runFile(dirPath1 + '\\' + file);
          } catch (err) {
            console.error('run  js error:', err);
          }


          let dataJson = [];
          let fileLocation = [];

          try { // find log.json file 
            dataJson = fs3.readFileSync(fileCPath, 'utf-8');
            fileLocation = fileCPath
            //console.log('读取内容:', dataJson);
          } catch (err) {
            if (err.code === 'ENOENT') {
              // console.log('文件不存在当前目录');
              try {
                dataJson = fs3.readFileSync(filePPath, 'utf-8');
                fileLocation = filePPath
                //console.log('读取内容:', dataJson);
              } catch (err) {
                if (err.code === 'ENOENT') {
                  //   console.log('文件不存在Cases根目录');
                  try {
                    dataJson = fs3.readFileSync(fileRootPath, 'utf-8');
                    fileLocation = fileRootPath
                    //console.log('读取内容:', dataJson);
                  } catch (err) {
                    if (err.code === 'ENOENT') {
                      //     console.log('文件不存在根目录');
                    }

                  }
                }

              }
            }

          }


          try {
            user1 = JSON.parse(dataJson);

            if (!Array.isArray(user1)) {
              //  console.log('检测到文件不是数组，正在转换为数组格式...');
              // 如果原文件是对象，把它包在数组里；如果是空的，创建空数组
              user1 = [user1];

              fs3.writeFileSync(fileLocation, JSON.stringify(user1, null, 2));
              //     console.log('✅ 成功写入！');
              dataJson = fs3.readFileSync(fileLocation, 'utf-8');
              //     console.log('✅ 再次读出！');
              user1 = JSON.parse(dataJson);

            }


            //删除log.json
            await fs2.remove(fileLocation);

            let final = [];
            final = ' ---------------------------------------(Success)'
            //搜索是否有failed的， 给个总体成功或失败
            if (dataJson.indexOf("faild") !== -1) {
              final = '---------------------------------------(Failed)'
            }
            if (dataJson.indexOf("not_found") !== -1) {
              final = '---------------------------------------(Failed)'
            }

            const newItem = {
              id: 0,
              title: caseName + final,
              time: new Date().toISOString()
            };
            // 头部追加
            user1.unshift(newItem);

            //  const resultJson = JSON.stringify(users, null, 2);

            allLogs = allLogs.concat(user1);
            // console.log(allLogs);
          } catch (readErr) {
            console.error(`concatenate error 1: `, readErr);
          }


        }
      }
      let target = [];
      try { //write log.json to merged-logs.json

        const systemTempDir = os.tmpdir();
        const myAppDir = path.join(systemTempDir, 'MyApp', 'Logs');
        const filePath = path.join(myAppDir, 'merged-logs.json');
        targetDir = myAppDir;
        await fs.mkdir(myAppDir, { recursive: true });

        fs1.writeFileSync(filePath, JSON.stringify(allLogs, null, 2));
        //   console.log('JSON 日志合并完成');
      } catch (err) {
        console.error('cancatenate error 2:', err);
      }

      try { // send email

        const data = require(path.join(__dirname, 'Utilities', 'Settings.json'));
        if (data.EMAIL_ENABLE === "true") {
          await runFile(path.join(__dirname, 'Utilities', 'email.js'));
        }

        const fileLocation1 = path.join(__dirname, 'roy-failure.png');
        const filePath1 = path.join(targetDir, 'roy-failure.png');
        //await fs2.remove(fileLocation1);


        if (fs0.existsSync(fileLocation1)) {
          //   console.log('✅ 文件存在');
          await fs2.rename(fileLocation1, filePath1);
          // 在这里读取或操作文件
        } else {
        }



      } catch (err) {
        console.error('cancatenate error:', err);
      }



    } catch (err) {
      console.error('unknown error:', err);
    }
  } catch (err) {
    console.error('unknown error:', err);
  }

})();


