let path = require('path');
let fs   = require('fs-extra');

const socketRooms = require(process.env['kugel-socket-rooms']);

module.exports = {

    treeSessions(src){

        // Get the sessions data from the data.json file, inside the folder named the id, inside the src folder.
        let sessions = {};

        fs.readdirSync(src).forEach(id => {

            // If the data.json file doesn't exists, create a data.json with the error data
            if(!fs.existsSync(path.join(src, id, 'data.json'))){

                let session = {
                    id: id,
                    next_action: 'Linha com defeito'
                };

                sessions[id] = session;

                return;

            };

            let session = fs.readJsonSync(path.join(src, id, 'data.json'));

            if(session.disabled) return;

            sessions[id] = session;

        });

        return sessions;

    },

    logSession(src, id, log){

        let logs = fs.readJsonSync(path.join(src, id, 'logs.json'));

        logs.push(log);

        fs.writeFileSync(path.join(src, id, 'logs.json'), JSON.stringify(logs, null, 4));

    },

    getSession(src, id){

        let data = fs.readJsonSync(path.join(src, id, 'data.json'));

        if(data.logs){

            data.logs = fs.readJsonSync(path.join(src, id, 'logs.json'));

        }

        return data;

    },

    deleteAllSessions(src){

        fs.emptyDirSync(src);

        return true;

    },

    putSession(src, id, session){

        if(!fs.existsSync(path.join(src, id))){

            console.log(`Session ${id} not found`);
            
            return false;
        }

        if(!fs.existsSync(path.join(src, id, 'data.json'))){

            let data = {
                id: id,
                next_action: 'Linha com defeito'
            };

            fs.writeFileSync(path.join(src, id, 'data.json'), JSON.stringify(data, null, 4));

        };

        let oldSession = fs.readJsonSync(path.join(src, id, 'data.json'));

        oldSession.updated_at = Date.now();

        let diff = Object.keys(session).filter(key => oldSession[key] !== session[key]);

        session = Object.assign(oldSession, session);

        fs.writeFileSync(path.join(src, id, 'data.json'), JSON.stringify(session, null, 4));

        socketRooms.notify('global', 'put session', session);

        // Stores on global file, stored in this way: process.cwd() / logs / sessions / day-month-year.json, that's an array of events, in table format

        // let date = new Date();

        // let day   = date.getDate();
        // let month = date.getMonth() + 1;
        // let year  = date.getFullYear();

        // let logsPath = path.join(process.cwd(), 'logs', 'sessions', `${day}-${month}-${year}.json`);

        // let logs = [];

        // if(fs.existsSync(logsPath)){

        //     logs = fs.readJsonSync(logsPath);

        // } else{

        //     fs.ensureFileSync(logsPath);

        // }

        // let logObj = {
        //     logged_at: new Date().toLocaleString()
        // }
 
        // logObj = Object.assign(logObj, session);

        // logObj.diff = diff;

        // logs.push(logObj);

        // fs.writeFileSync(logsPath, JSON.stringify(logs, null, 4));

        return true;

    },

    getLog(date){

        let logsPath = path.join(process.cwd(), 'logs', 'sessions', date + '.json');

        if(!fs.existsSync(logsPath)) return false;

        return fs.readJsonSync(logsPath);

    },

    getLogs(){

        let logsPath = path.join(process.cwd(), 'logs', 'sessions');

        let logs = {};

        fs.readdirSync(logsPath).forEach(file => {

            let date = file.split('.')[0];

            let data = fs.readJsonSync(path.join(logsPath, file));

            logs[date] = data;

        });

        return logs;

    },

    createSessions(src, id, session){

        // Create a folder, inside the src, named the id,
        // Inside the folder, create a file with the session data, named data.json,
        // Inside the folder, create a file named logs.json, which will contain the logs of the session,
        // With the logs enabled, the system gonna log the entire try of clicks and important steps like screenshots.
        // These results are collected and stored in the logs.json file.

        // The important info of the session, like the actions needed, are stored in the data.json
        // AutomathSoftware will read the data.json file and interpret the actions needed to be done, but actions to be taken,
        // are also going to be at the data.json, like: { nextAction: 'register'}

        if(fs.existsSync(path.join(src, id))) return module.exports.putSession(src, id, session);

        fs.mkdirSync(path.join(src, id));

        console.log('Session folder created: ' + id);

        session = Object.assign({
            created_at: Date.now(),
            updated_at: Date.now(),
            logs: true
        }, session);

        fs.writeFileSync(path.join(src, id, 'data.json'), JSON.stringify(session, null, 4));
        fs.writeJsonSync(path.join(src, id, 'logs.json'), [{
            created_at: Date.now(),
            message: 'Session created'
        }]);

        console.log('Session created: ' + id);

        return true;

    },

    deleteSession(src, id){

        return new Promise((resolve, reject) => {

            fs.rmdir(path.join(src, id), {
                recursive: true
            }, (err) => {
    
                if(err) reject(err);
                else resolve(true);
    
            });

        });

    }

}