import fs from 'fs'
import get from 'lodash-es/get.js'
import getPathParent from 'wsemi/src/getPathParent.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'


let writeJson = (fp, obj, opt = {}) => {
    let structured = get(opt, 'structured', false)
    try {
        if (structured) {
            obj = JSON.stringify(obj, null, 2)
        }
        else {
            obj = JSON.stringify(obj)
        }
        let fd = getPathParent(fp)
        if (!fsIsFolder(fd)) {
            fsCreateFolder(fd)
        }
        fs.writeFileSync(fp, obj, 'utf8')
    }
    catch (err) {
        console.log(err)
    }
}


export default writeJson
