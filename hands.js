const puppeteer      = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
const fs             = require('fs-extra');
const path           = require('path');
const execSync       = require('child_process').execSync;
const exec           = require('child_process').exec;
const kugel          = require('kugel');
const fetch          = require('node-fetch');

const util = require('hands/util');

puppeteerExtra.use(StealthPlugin());

const HEADLESS = process.env.HEADLESS === 'true';

module.exports = {

    ips: [],

    pipeline: {},

    actions: {},

    activeInstances: {},

    async getIps(){

        let ips = await fetch('https://acq.iemoapi.com/getProxyIp?regions=br&lb=1&return_type=txt&protocol=http&num=100');

        ips = await ips.text();

        ips = ips.split('\r\n');

        module.exports.ips = module.exports.ips.concat(ips);

    },

    async getIp(){

        if(module.exports.ips.length === 0){

            await module.exports.getIps();

        }

        let ip = module.exports.ips.shift();

        return ip;

    },

    addToPipeline(sessionsPath, ids, action, fifo = false){

        let sessions = util.treeSessions(sessionsPath);

        if(process.platform == 'linux'){

            try{

                execSync(path.join(__dirname, 'free.ram.sh'));
                console.log(`@execSync: ./free.ram.sh ${ids.join(', ')}`)
    
            } catch(err){
    
                console.log(err);
    
            }
    
        }

        ids.forEach(id => {

            let session = sessions[id];

            if(!session) return;

            session.status = 'Aguardando';
            session.userIndentAction = action;

            util.putSession(sessionsPath, id, session);

            this.pipeline[sessionsPath] ??= [];

            if(!fifo) this.pipeline[sessionsPath].push(session);
            else this.pipeline[sessionsPath].unshift(session);

            delete sessions[id];

        });

    },

    async createInstance(session){

        session.status = 'Em execução';

        util.putSession(session.sessionPath, session.id, session);

        if(!session.userIndentAction) return console.log('No action defined');

        let actionsFolder = path.join(process.env['automath-backend'], 'karon', 'actions');
        let actions = {};

        try{

            fs.readdirSync(actionsFolder).forEach(folderAction => {

                // Clear require cache
                delete require.cache[require.resolve(path.join(actionsFolder, folderAction, folderAction + '.js'))];
    
                try{
    
                    let action = require(path.join(actionsFolder, folderAction, folderAction + '.js'));
    
                    actions[folderAction] = action;
    
                } catch(err){
    
                    console.log(err);
    
                }
    
            });
    
            return module.exports.run(session, actions, session.sessionPath, session.userIndentAction);
        
        } catch(err){

            console.log(err);

        }

    },

    async runSession(sessionFolder, sessionId, actionsFolder, forceAction = null){

        let session = util.getSession(sessionFolder, sessionId);

        if(!session) throw new Error('Session not found: ' + sessionId);

        let actions = {};

        fs.readdirSync(actionsFolder).forEach(folderAction => {

            let action = require(path.join(actionsFolder, folderAction, folderAction + '.js'));

            actions[folderAction] = action;

        });

        session.status = 'running';

        util.putSession(sessionFolder, session.id, session);

        return this.run(session, actions, sessionFolder, forceAction).then(() => {

            session.status = 'not running';

            util.putSession(sessionFolder, session.id, session);

        }).catch(err => {

            session.status = 'crashed';

            util.putSession(sessionFolder, session.id, session);

            console.log(err);

        });

    },

    async restart(){

        const restartDelay = 2000;

        exec(path.join(__dirname, 'restart.puppeteer.sh'), (err, stdout, stderr) => {

            console.error('@pupeeteer restart');

            if(err) console.log(err);

            console.log(stdout);

        });

        return new Promise(resolve => setTimeout(resolve, restartDelay));

    },

    async open(){

        if(!process.env.CHROME_PATH) return Promise.reject(new Error('Chrome path not defined! Please set the environment variable CHROME_PATH'));

        let args = process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [];

        let browser = await puppeteerExtra.launch({
            headless: HEADLESS,
            executablePath: process.env.CHROME_PATH,
            args: args,
            userDataDir: path.join(process.cwd(), 'user-data')
        }).catch(async e => {

            console.log(e);

            // Vamos então rodar .restart, que vai chamar um arquivo .sh que vai reiniciar o puppeteer ./bin/restart-puppeteer.sh
            await module.exports.restart();

            return puppeteerExtra.launch({
                headless: HEADLESS,
                executablePath: process.env.CHROME_PATH,
                args: args,
                userDataDir: path.join(process.cwd(), 'user-data')
            }).catch(e => {

                console.error('Puppeteer CRASHOU PELA SEGUNDA VEZ!');

                throw e;

            });

        });

        let page = await browser.newPage();

        browser.on('disconnected', async () => {

            console.log('Closed');

        });

        page.on('close', () => {

            browser.close();
            
        });

        return {
            browser: browser,
            page: page
        }
        
    },

    async run(session, actions, sessionFolder, forceAction = null){

        let action = forceAction || session.next_action;
        let proxy  = true;

        // @todo Essa linha estámuito mal feita
        if(actions[action]?.proxy == false) proxy = false;

        if(process.env.PROXY_ALL == 'false') proxy = false;

        return new Promise(async (resolve, reject) => {

            if(!process.env.CHROME_PATH) reject(new Error('Chrome path not defined! Please set the environment variable CHROME_PATH'));

            if(module.exports.activeInstances[session.id]) return resolve();

            module.exports.activeInstances[session.id] = {
                session: session             
            }

            let args = process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [];

            if(proxy){

                let proxyServer = await module.exports.getIp();

                args.push('--proxy-server=' + proxyServer);

                session.proxy = proxyServer;

                util.putSession(sessionFolder, session.id, session);

            }

            let userDataDir = path.join(session.sessionPath, session.id, 'user-data');

            if(fs.existsSync(userDataDir)){

                fs.removeSync(userDataDir);

            }

            let browser = await puppeteerExtra.launch({
                headless: HEADLESS,
                executablePath: process.env.CHROME_PATH,
                args: args,
                userDataDir: userDataDir
            });

            let page = await browser.newPage();

            module.exports.activeInstances[session.id] = {
                session: session,
                browser: browser,
                page: page   
            }

            browser.on('disconnected', async () => {

                delete module.exports.activeInstances[session.id];

                session.status = ' ';

                util.putSession(sessionFolder, session.id, session);

                resolve();

            });

            page.on('close', () => {

                browser.close();
                
            });

            if(actions[action]){

                actions[action](session, page, {

                    log(msg){

                        fs.ensureDirSync(path.join(sessionFolder, session.id, 'screenshots'));

                        let screenshotPath = path.join(session.id, 'screenshots', new Date().getTime() + '.png');

                        return page.screenshot({
                            path: path.join(sessionFolder, screenshotPath),
                            fullPage: true
                        }).then(() => {

                            return util.logSession(sessionFolder, session.id, {
                                msg: msg,
                                at: new Date(),
                                screenshot: screenshotPath
                            });

                        });

                    },

                    putSession(objToAssign){

                        console.log('putSession-' + session.id, objToAssign);

                        Object.assign(session, objToAssign);

                        util.putSession(sessionFolder, session.id, session);

                    }

                }).then(resolve).catch(e => {

                    browser.close();

                    session.status = e.toString();
                    session.next_action = session.status;

                    util.putSession(sessionFolder, session.id, session);
    
                    console.log(e);

                });

            } else{

                reject(new Error('Action not found: ' + action));

            }

        });

    }

}

kugel.Component.on('socket-listen', async app => {

});

setTimeout(function(){

    // Verificamos aqui se os scripts .sh estão com permissão de execução
    // Se não estiverem, vamos solicitar ao usuário, para que não de process.exit

    let scripts = [
        'free.ram.sh',
        'restart.puppeteer.sh'
    ];

    let fatal = false;

    for(let script of scripts){

        let scriptPath = path.join(__dirname, script);

        if(!fs.existsSync(scriptPath)) continue;

        let stat = fs.statSync(scriptPath);

        if(!(stat.mode & 1)){

            console.log(`Script ${script} não tem permissão de execução. Isso pode prejudicar o funcionamento do hands`);
            fatal = true;

        }

    }

    scripts = scripts.map(script => {

        return path.join('./node_modules/hands/', script);

    });

    if(fatal){

        console.log('Para corrigir, execute o comando: chmod +x ' + scripts.join(' '));
        // process.exit();

    }

}, 4000);