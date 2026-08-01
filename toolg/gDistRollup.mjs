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
        },
        external: [
        ],
    })
        .catch((err) => {
            console.log(err)
        })

}
rp()
    .catch((err) => {
        console.log(err)
    })

