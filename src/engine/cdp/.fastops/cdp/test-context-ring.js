const CDP = require('chrome-remote-interface');

async function checkContextRing() {
    let client;
    try {
        client = await CDP({ port: 9223, local: true });
        const { Runtime } = client;
        await Runtime.enable();
        
        // Let's look for SVG elements near the chat input area that might represent the context ring
        const expression = `
            (() => {
                const svgs = Array.from(document.querySelectorAll('svg'));
                const ringData = [];
                
                for (const svg of svgs) {
                    // Look for circles inside SVGs, which usually make up these radial charts
                    const circles = Array.from(svg.querySelectorAll('circle'));
                    for (const circle of circles) {
                        const strokeDasharray = circle.getAttribute('stroke-dasharray');
                        const strokeDashoffset = circle.getAttribute('stroke-dashoffset');
                        const style = circle.getAttribute('style');
                        
                        if (strokeDasharray || strokeDashoffset || (style && style.includes('stroke-dash'))) {
                            ringData.push({
                                parentClass: svg.parentElement ? svg.parentElement.className : 'unknown',
                                dasharray: strokeDasharray,
                                dashoffset: strokeDashoffset,
                                style: style,
                                viewBox: svg.getAttribute('viewBox'),
                                class: svg.className.baseVal
                            });
                        }
                    }
                }
                
                // Let's also just grab the classes of all SVGs to see what's there
                const allSvgClasses = svgs.map(s => s.className.baseVal).filter(Boolean);
                
                return { ringData, allSvgClasses: [...new Set(allSvgClasses)] };
            })()
        `;
        
        const result = await Runtime.evaluate({ 
            expression: expression, 
            returnByValue: true 
        });
        
        console.log("=== CONTEXT RING DOM DUMP ===");
        console.log(JSON.stringify(result.result.value, null, 2));
        
    } catch (err) {
        console.error('Failed:', err.message);
    } finally {
        if (client) await client.close();
    }
}

checkContextRing();