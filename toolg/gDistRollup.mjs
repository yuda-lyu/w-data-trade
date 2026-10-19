// import path from 'path'
import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


async function rp() {

    await rollupFiles({ //rollupFiles預設會clean folder
        fns: 'WDataTrade.mjs',
        fdSrc,
        fdTar,
        nameDistType: 'kebabCase',
        // bNodePolyfill: true,
        // bMinify: false,
        globals: {
            path: 'path',
            fs: 'fs',
        },
        external: [
            'path',
            'fs',
        ],
    })
        .catch((err) => {
            //建置失敗須以非0結束, 使發布流程得知
            console.log(err)
            process.exitCode = 1
        })

}
rp()
    .catch((err) => {
        //建置失敗須以非0結束, 使發布流程得知
        console.log(err)
        process.exitCode = 1
    })

