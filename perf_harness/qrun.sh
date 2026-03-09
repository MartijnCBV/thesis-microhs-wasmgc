#!/bin/bash

if [ $# -eq 0 ]; then
    echo "Usage: $0 <program_name>"
    echo "Example: $0 simple"
    exit 1
fi

PROGRAM_NAME=$1
wasm -d programs/${PROGRAM_NAME}.wat -o programs/${PROGRAM_NAME}.wasm -j
node cli run programs/${PROGRAM_NAME}.wasm -o results/${PROGRAM_NAME}.json -w 100 -i 1000
# node cli run programs/sanity_emcc.js -o results/sanity_emcc.json -w 100 -i 1000

# wasm-opt programs/${PROGRAM_NAME}.wat -o programs/${PROGRAM_NAME}_opt.wat -S
# wasm -d programs/${PROGRAM_NAME}_opt.wat -o programs/${PROGRAM_NAME}_opt.wasm -j
# node cli run programs/${PROGRAM_NAME}_opt.wasm -o results/${PROGRAM_NAME}_opt.json -w 100 -i 1000