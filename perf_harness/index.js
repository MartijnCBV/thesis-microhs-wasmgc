const WasmRunner = require('./wasm-runner');
const path = require('path');

async function example() {
    const runner = new WasmRunner();
    const wasmFilePath = path.join(__dirname, 'programs/42.wasm');
    
    try {
        const results = await runner.runBenchmark(wasmFilePath, {
            iterations: 10,
            warmupRuns: 3,
            functionName: 'main',
            args: []
        });
        
        console.log(runner.formatResults(results));
    } catch (error) {
        console.error('Benchmark failed:', error.message);
    }
}

if (require.main === module) {
    example();
}