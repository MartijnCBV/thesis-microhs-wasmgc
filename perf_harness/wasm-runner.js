const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class PerformanceRunner {
    graph = [];

    constructor() {
        this.results = [];
    }

    async loadWasm(wasmPath) {
        try {
            const wasmBuffer = fs.readFileSync(wasmPath);
            const imports = {
                env: {
                    print: (arg) => {
                        console.log(`WASM print:`, arg);
                    },
                    graphAdd: (arg) => {
                        this.graph.push(arg);
                    },
                    graphPrint: () => {
                        console.log('WASM graphPrint called:');
                        // -1 is null
                        // -2 indicates that we are entering the left node
                        // -3 indicates that we are entering the right node
                        // so [-2, 2, -3, -2, 2, -3, 5] means:
                        //         o
                        //        / \
                        //       2   o
                        //          / \
                        //         2   5
                        // where 'o' is an internal node
                        // and [-2, -2, -2, 8, -3, 19, -3, 12, -3, 13] means:
                        //           o
                        //          / \
                        //         o   13
                        //        / \
                        //       o   12
                        //      / \
                        //     8   19
                        //
                        
                        function buildTree(arr) {
                            if (!arr || arr.length === 0) return null;
                            let index = 0;
                            function buildNode() {
                                if (index >= arr.length) return null;
                                const current = arr[index++];
                                if (current === -1) {
                                    return null;
                                }
                                if (current >= 0) {
                                    return { value: current, left: null, right: null };
                                }
                                const node = { value: null, left: null, right: null };
                                if (current === -2) {
                                    node.left = buildNode();
                                    if (index < arr.length && arr[index] === -3) {
                                        index++;
                                        node.right = buildNode();
                                    }
                                } else if (current === -3) {
                                    node.right = buildNode();
                                }
                                return node;
                            }
                            return buildNode();
                        }

                        const tree = buildTree([...this.graph]);

                        const generateDot = (node) => {
                            let dot = 'digraph G {\n';
                            let count = 0;

                            const traverse = (n) => {
                                const currentId = count++;
                                if (n.value !== null) {
                                    dot += `  node${currentId} [label="${n.value}"];\n`;
                                } else {
                                    dot += `  node${currentId} [label=""];\n`;
                                }
                                if (n.left) {
                                    const leftId = traverse(n.left);
                                    dot += `  node${currentId} -> node${leftId};\n`;
                                }
                                if (n.right) {
                                    const rightId = traverse(n.right);
                                    dot += `  node${currentId} -> node${rightId};\n`;
                                }
                                return currentId;
                            };

                            traverse(node);
                            dot += '}';
                            return dot;
                        };

                        const dotRepresentation = generateDot(tree);
                        console.log(dotRepresentation);

                        this.graph = [];
                    }
                }
            };
            const wasmModule = await WebAssembly.instantiate(wasmBuffer, imports);
            
            if (wasmModule.instance.exports.memory) {
                this.wasmMemory = wasmModule.instance.exports.memory;
            }
            
            return wasmModule;
        } catch (error) {
            throw new Error(`Failed to load WASM file: ${error.message}`);
        }
    }

    // NOTE: expects emscripten generated module
    async loadJavaScript(jsPath) {
        try {
            console.log(`Loading JavaScript module from: ${jsPath}`);
            const jsCode = fs.readFileSync(jsPath, 'utf8');
            const moduleContext = {
                Module: {
                    print: (arg) => {
                        console.log(`JS print:`, arg);
                    },
                    printErr: (arg) => {
                        console.error(`JS printErr:`, arg);
                    },
                    onRuntimeInitialized: null,
                    noExitRuntime: true
                },
                console: {
                    log: (...args) => console.log('JS log:', ...args),
                    warn: (...args) => console.warn('JS warn:', ...args),
                    error: (...args) => console.error('JS error:', ...args)
                },
                process: process,
                require: require,
                __filename: jsPath,
                __dirname: path.dirname(jsPath),
                global: global,
                Buffer: Buffer,
                WebAssembly: WebAssembly,
                stringToNewUTF8: (str) => {
                    const encoder = new TextEncoder();
                    return encoder.encode(str + '\0');
                },
                UTF8ToString: (ptr) => {
                    // Simple stub - in real Emscripten this reads from WASM memory
                    return 'some string'
                    // return ptr ? ptr.toString() : '';
                },
                _malloc: (size) => {
                    return new ArrayBuffer(size);
                },
                _free: (ptr) => {
                    return;
                },
                window: global,
                self: global,
                importScripts: () => {},
                exports: {},
                module: { exports: {} }
            };

            const vm = require('vm');            
            const context = vm.createContext(moduleContext);
            
            context.Module.env = {
                print: context.Module.print,
                graphAdd: context.graphAdd,
                graphPrint: context.graphPrint
            };

            let hasExecuted = false;
            context._scriptExecuted = () => { hasExecuted = true; };

            const script = new vm.Script(jsCode, { filename: jsPath });
            script.runInContext(context);

            hasExecuted = true;

            if (context.Module.onRuntimeInitialized && typeof context.Module.onRuntimeInitialized === 'function') {
                await new Promise((resolve) => {
                    const originalCallback = context.Module.onRuntimeInitialized;
                    context.Module.onRuntimeInitialized = () => {
                        if (originalCallback) originalCallback();
                        resolve();
                    };
                });
            }

            const executeScript = () => {
                try {
                    // Reset the graph for each execution
                    this.graph = [];
                    
                    // Re-execute the script
                    const newScript = new vm.Script(jsCode, { filename: jsPath });
                    newScript.runInContext(context);
                    
                    return 0;
                } catch (error) {
                    console.error('Script execution error:', error.message);
                    return -1;
                }
            };

            return {
                instance: {
                    exports: {
                        ...context.Module,
                        _scriptRun: executeScript,
                        _hasExecuted: () => hasExecuted
                    }
                },
                context: context,
                executeScript: executeScript
            };
            
        } catch (error) {
            throw new Error(`Failed to load JavaScript file: ${error.message}`);
        }
    }

    async loadModule(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.wasm') {
            return await this.loadWasm(filePath);
        } else if (ext === '.js') {
            return await this.loadJavaScript(filePath);
        } else {
            throw new Error(`Unsupported file type: ${ext}. Supported types: .wasm, .js`);
        }
    }

    measureMemory() {
        const used = process.memoryUsage();
        return {
            heapUsed: used.heapUsed,
            heapTotal: used.heapTotal,
            external: used.external,
            rss: used.rss
        };
    }

    async runBenchmark(filePath, options = {}) {
        const {
            iterations = 1,
            warmupRuns = 0,
            functionName = 'main',
            args = [],
            measureMemory = true
        } = options;

        const ext = path.extname(filePath).toLowerCase();
        console.log(`Loading ${ext === '.wasm' ? 'WASM' : 'JavaScript'} module from: ${filePath}`);
        
        const module = await this.loadModule(filePath);
        
        let targetFunction;
        let isScriptExecution = false;
        
        if (ext === '.wasm') {
            if (!module.instance.exports[functionName]) {
                throw new Error(`Function '${functionName}' not found in WASM exports`);
            }
            targetFunction = module.instance.exports[functionName];
        } else if (ext === '.js') {
            if (functionName === 'main' || functionName === '_scriptRun' || !module.instance.exports[functionName]) {
                targetFunction = module.executeScript;
                isScriptExecution = true;
                console.log('Using script execution mode for JavaScript file');
            } else {
                targetFunction = module.instance.exports[functionName] || 
                               module.context.Module[functionName] ||
                               module.context[functionName];
                
                if (!targetFunction) {
                    console.log('Available exports:', Object.keys(module.instance.exports || {}));
                    console.log('Available Module functions:', Object.keys(module.context.Module || {}));
                    
                    targetFunction = module.executeScript;
                    isScriptExecution = true;
                    console.log('Function not found, falling back to script execution');
                }
            }
        }

        const results = {
            filePath,
            fileType: ext,
            functionName: isScriptExecution ? 'script_execution' : functionName,
            iterations,
            warmupRuns,
            runs: [],
            summary: {}
        };

        if (warmupRuns > 0) {
            console.log(`Performing ${warmupRuns} warmup runs...`);
            for (let i = 0; i < warmupRuns; i++) {
                if (typeof targetFunction === 'function') {
                    if (isScriptExecution) {
                        targetFunction();
                    } else {
                        targetFunction(...args);
                    }
                }
            }
        }

        console.log(`Running ${iterations} benchmark iterations...`);

        const initialMemory = measureMemory ? this.measureMemory() : null;

        for (let i = 0; i < iterations; i++) {
            const runStart = process.hrtime.bigint();
            const memoryBefore = measureMemory ? this.measureMemory() : null;
            
            let result;
            try {
                if (typeof targetFunction === 'function') {
                    if (isScriptExecution) {
                        result = targetFunction();
                    } else {
                        result = targetFunction(...args);
                    }
                } else {
                    result = 0; // Default result if no function
                }
            } catch (error) {
                throw new Error(`Execution failed on iteration ${i + 1}: ${error.message}`);
            }

            const runEnd = process.hrtime.bigint();
            const memoryAfter = measureMemory ? this.measureMemory() : null;

            const runTime = Number(runEnd - runStart) / 1_000_000;

            const runResult = {
                iteration: i + 1,
                executionTime: runTime,
                result: result,
                memory: measureMemory ? {
                    before: memoryBefore,
                    after: memoryAfter,
                    delta: {
                        heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
                        heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
                        external: memoryAfter.external - memoryBefore.external,
                        rss: memoryAfter.rss - memoryBefore.rss
                    }
                } : null
            };

            results.runs.push(runResult);
            
            if ((i + 1) % Math.max(1, Math.floor(iterations / 10)) === 0) {
                console.log(`Completed ${i + 1}/${iterations} iterations`);
            }
        }

        const executionTimes = results.runs.map(run => run.executionTime);
        results.summary = this.calculateStatistics(executionTimes);

        if (measureMemory && initialMemory) {
            const finalMemory = this.measureMemory();
            results.summary.memoryUsage = {
                initial: initialMemory,
                final: finalMemory,
                totalDelta: {
                    heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
                    heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
                    external: finalMemory.external - initialMemory.external,
                    rss: finalMemory.rss - initialMemory.rss
                }
            };
        }

        this.results.push(results);
        return results;
    }

    calculateStatistics(values) {
        if (values.length === 0) return {};

        const sorted = values.slice().sort((a, b) => a - b);
        const sum = values.reduce((acc, val) => acc + val, 0);
        const mean = sum / values.length;
        
        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        return {
            count: values.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean: mean,
            median: sorted.length % 2 === 0 
                ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                : sorted[Math.floor(sorted.length / 2)],
            stdDev: stdDev,
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)]
        };
    }

    formatResults(results, format = 'console') {
        if (format === 'json') {
            return JSON.stringify(results, null, 2);
        }

        let output = '';
        output += `\n=== Performance Results ===\n`;
        output += `File: ${results.filePath}\n`;
        output += `Type: ${results.fileType === '.wasm' ? 'WebAssembly' : 'JavaScript'}\n`;
        output += `Function: ${results.functionName}\n`;
        output += `Iterations: ${results.iterations}\n`;
        output += `Warmup Runs: ${results.warmupRuns}\n\n`;

        output += `Execution Time Statistics (ms):\n`;
        output += `  Min:    ${results.summary.min?.toFixed(3)}\n`;
        output += `  Max:    ${results.summary.max?.toFixed(3)}\n`;
        output += `  Mean:   ${results.summary.mean?.toFixed(3)}\n`;
        output += `  Median: ${results.summary.median?.toFixed(3)}\n`;
        output += `  StdDev: ${results.summary.stdDev?.toFixed(3)}\n`;
        output += `  P95:    ${results.summary.p95?.toFixed(3)}\n`;
        output += `  P99:    ${results.summary.p99?.toFixed(3)}\n`;

        if (results.summary.memoryUsage) {
            output += `\nMemory Usage:\n`;
            output += `  Initial Heap: ${this.formatBytes(results.summary.memoryUsage.initial.heapUsed)}\n`;
            output += `  Final Heap:   ${this.formatBytes(results.summary.memoryUsage.final.heapUsed)}\n`;
            output += `  Heap Delta:   ${this.formatBytes(results.summary.memoryUsage.totalDelta.heapUsed)}\n`;
            output += `\n`;
            output += `  Initial RSS:  ${this.formatBytes(results.summary.memoryUsage.initial.rss)}\n`;
            output += `  Final RSS:    ${this.formatBytes(results.summary.memoryUsage.final.rss)}\n`;
            output += `  RSS Delta:    ${this.formatBytes(results.summary.memoryUsage.totalDelta.rss)}\n`;
        }

        return output;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
        const sign = bytes < 0 ? '-' : '';
        return sign + (Math.abs(bytes) / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    }

    saveResults(results, outputPath) {
        const data = {
            timestamp: new Date().toISOString(),
            results: results
        };
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`Results saved to: ${outputPath}`);
    }
}

// Keep backward compatibility
class WasmRunner extends PerformanceRunner {
    constructor() {
        super();
        console.warn('WasmRunner is deprecated. Use PerformanceRunner instead.');
    }
}

module.exports = PerformanceRunner;
module.exports.WasmRunner = WasmRunner;
module.exports.PerformanceRunner = PerformanceRunner;