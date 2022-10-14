import { buildProgramFromSources, loadShadersFromURLS, setupWebGL } from '../libs/utils.js';
import { vec2, flatten, subtract, dot, scale } from '../libs/MV.js';

// Buffers: particles before update, particles after update, quad vertices
let inParticlesBuffer, outParticlesBuffer, quadBuffer;

// Particle system constants

const DIST_SCALE = 6371000.0;
const AVG_DENSITY = 5510.0;

// Total number of particles
const N_PARTICLES = 100000;


let radius = [];
let position = [];
let pMass = [];
let counter = 0;
let beamAngle = Math.PI;
let beamOpen = 0.0;
let minVelocity = 0.1;
let maxVelocity = 0.2;
let minLife = 2;
let maxLife = 10;


let drawPoints = true;
let drawField = true;
let canDrawPlanets = true;
let shiftIsPressed = false;

let time = undefined;
let lastCursorLocation = vec2(0.0);

function main(shaders)
{
    // Generate the canvas element to fill the entire page
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);

    const SCALE = vec2(1.5, 1.5 * (canvas.height / canvas.width));

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    /** type {WebGL2RenderingContext} */
    const gl = setupWebGL(canvas, {alpha: true});

    // Initialize GLSL programs    
    const fieldProgram = buildProgramFromSources(gl, shaders["field-render.vert"], shaders["field-render.frag"]);
    const renderProgram = buildProgramFromSources(gl, shaders["particle-render.vert"], shaders["particle-render.frag"]);
    const updateProgram = buildProgramFromSources(gl, shaders["particle-update.vert"], shaders["particle-update.frag"], ["vPositionOut", "vAgeOut", "vLifeOut", "vVelocityOut"]);

    gl.viewport(0,0,canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    // Enable Alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); 

    buildQuad();
    buildParticleSystem(N_PARTICLES);

    window.addEventListener("resize", function(event) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0,0,canvas.width, canvas.height);
    });

    window.addEventListener("keydown", function(event) {
        console.log(event.key);
        switch(event.key) {
            case "PageUp":
                if(!shiftIsPressed)
                    maxVelocity += 0.01;
                else if (minVelocity + 0.01 < maxVelocity)
                    minVelocity += 0.01;
                break;
            case "PageDown":
                if(shiftIsPressed && minVelocity - 0.01 > 0)
                    minVelocity -= 0.01;
                else if (maxVelocity - 0.01 > minVelocity)
                    maxVelocity -= 0.01;
                break;
            case "ArrowUp":
                if(beamAngle + 0.05 <= Math.PI)
                    beamAngle += 0.05;
                else
                    beamAngle = Math.PI;
                break;
            case "ArrowDown":
                if(beamAngle - 0.05 >= 0)
                    beamAngle -= 0.05;
                else
                    beamAngle = 0;
                break;
            case "ArrowLeft":
                    beamOpen += 0.05;
                break;
            case "ArrowRight":
                    beamOpen -= 0.05;
                break;
            case 'q':
                if(minLife + 0.5 > maxLife)
                    break;
                if(minLife + 0.5 > 19)
                    minLife = 19;
                else
                    minLife += 0.5;
                break;
            case 'a':
                if(minLife - 0.5 < 1)
                    minLife = 1;
                else
                    minLife -= 0.5;
                break;
            case 'w':
                if(maxLife + 0.5 > 20)
                    maxLife = 20;
                else
                    maxLife += 0.5;
                break;
            case 's':
                if(maxLife - 0.5 < minLife)
                    break;
                if(maxLife - 0.5 < 2)
                    maxLife = 2;
                else
                    maxLife -= 0.5;
                break;
            case '0':
                drawField = !drawField;
                break;
            case '9':
                drawPoints  = !drawPoints;
                break; 
            case 'Shift':
                shiftIsPressed = true;
                break;
        }
    });

    window.addEventListener("keyup", function(event) {
        console.log(event.key);
        switch(event.key) {
            case 'Shift':
                shiftIsPressed = false;
        }});
    
    canvas.addEventListener("mousedown", function(event) {
        const p = getScaledCursorPosition(canvas, event);
        if(canDrawPlanets)
        position.push(p);
    });

    canvas.addEventListener("mousemove", function(event) {
        getScaledCursorPosition(canvas, event);
    });

    canvas.addEventListener("mouseup", function(event) {
        const p = getScaledCursorPosition(canvas, event);

        if(canDrawPlanets) {
            radius.push(DIST_SCALE * Math.sqrt(Math.pow(p[0]-position[counter][0],2) + Math.pow(p[1]-position[counter][1],2)));
            const mass = (4 * Math.PI * Math.pow(radius[counter],3) * AVG_DENSITY) / 3;
            pMass.push(mass);
            counter++;
            if(counter == 10)    canDrawPlanets = false;
        }
    });

    function getCursorPosition(canvas, event) {
        const mx = event.offsetX;
        const my = event.offsetY;

        const x = (mx / canvas.width * 2) - 1;
        const y = (canvas.height - my)/canvas.height * 2 - 1;

        return vec2(x,y);
    }

    function getScaledCursorPosition(canvas, event) {
        
        const mx = event.offsetX;
        const my = event.offsetY;

        lastCursorLocation[0] = ((mx / canvas.width * 2) - 1) * SCALE[0];
        lastCursorLocation[1] = (((canvas.height - my)/canvas.height * 2) - 1) * SCALE[1];
        
        const x = ((mx / canvas.width * 2) - 1) * SCALE[0];
        const y = (((canvas.height - my)/canvas.height * 2) - 1) * SCALE[1];

        return vec2(x,y);
    }

    window.requestAnimationFrame(animate);

    function buildParticleSystem(nParticles) {
        const data = [];

        for(let i=0; i<nParticles; ++i) {
            // position
            const x = 3*Math.random() - 1.5;
            const y = 3*Math.random() - 1.5;
            //const x = lastCursorLocation[0];
            //const y = lastCursorLocation[1];

            data.push(x); data.push(y);
            
            // age
            data.push(0.0);

            // life
            let life = minLife + Math.random() * (maxLife - minLife);
            data.push(life);

            // velocity
            let velocity = minVelocity + Math.random() * (maxVelocity - minVelocity);
            let angle = 2.0 * Math.PI * (Math.random() - 1);
            data.push(velocity*Math.cos(angle));
            data.push(velocity*Math.sin(angle));
        }

        inParticlesBuffer = gl.createBuffer();
        outParticlesBuffer = gl.createBuffer();

        // Input buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, inParticlesBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flatten(data), gl.STREAM_DRAW);

        // Output buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, outParticlesBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flatten(data), gl.STREAM_DRAW);
    }

    function animate(timestamp)  {
        let deltaTime = 0;

        if(time === undefined) {        // First time
            time = timestamp/1000;
            deltaTime = 0;
        } 
        else {                          // All other times
            deltaTime = timestamp/1000 - time;
            time = timestamp/1000;
        }

        window.requestAnimationFrame(animate);

        // Clear framebuffer
        gl.clear(gl.COLOR_BUFFER_BIT);

        if(drawField) drawQuad();
        updateParticles(deltaTime);
        if(drawPoints) drawParticles(outParticlesBuffer, N_PARTICLES);
        if(canDrawPlanets) drawPlanets();

        swapParticlesBuffers();
    }

    function updateParticles(deltaTime)
    {

        gl.useProgram(updateProgram);

        // Setup uniforms
        const uDeltaTime = gl.getUniformLocation(updateProgram, "uDeltaTime");
        const uMouseLocation = gl.getUniformLocation(updateProgram, "uMouseLocation");
        const uAngle = gl.getUniformLocation(updateProgram, "uBeamAngle");
        const uOpen = gl.getUniformLocation(updateProgram, "uBeamOpen");
        const uCount = gl.getUniformLocation(updateProgram, "uCounter");
        const uMinVelocity = gl.getUniformLocation(updateProgram, "uMinVelocity");
        const uMaxVelocity = gl.getUniformLocation(updateProgram, "uMaxVelocity");
        const uMinLife = gl.getUniformLocation(updateProgram, "uMinLife");
        const uMaxLife = gl.getUniformLocation(updateProgram, "uMaxLife");

        for(let i=0; i<counter; i++) {
            // Get the location of the uniforms...
            const uPosition = gl.getUniformLocation(updateProgram, "uPosition[" + i + "]");
            const uMass = gl.getUniformLocation(updateProgram, "uMass[" + i + "]");
            // Send the corresponding values to the GLSL program
            gl.uniform2fv(uPosition, position[i]);
            gl.uniform1f(uMass, pMass[i]);
        }

        gl.uniform1f(uDeltaTime, deltaTime);
        gl.uniform1f(uAngle, beamAngle);
        gl.uniform1f(uOpen, beamOpen);
        gl.uniform1i(uCount, counter);
        gl.uniform1f(uMinVelocity, minVelocity);
        gl.uniform1f(uMaxVelocity, maxVelocity);
        gl.uniform1f(uMinLife, minLife);
        gl.uniform1f(uMaxLife, maxLife);
        if(shiftIsPressed)
            gl.uniform2f(uMouseLocation, lastCursorLocation[0], lastCursorLocation[1]);


        // Setup attributes
        const vPosition = gl.getAttribLocation(updateProgram, "vPosition");
        const vAge = gl.getAttribLocation(updateProgram, "vAge");
        const vLife = gl.getAttribLocation(updateProgram, "vLife");
        const vVelocity = gl.getAttribLocation(updateProgram, "vVelocity");

        gl.bindBuffer(gl.ARRAY_BUFFER, inParticlesBuffer);

        gl.vertexAttribPointer(vPosition, 2, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(vAge, 1, gl.FLOAT, false, 24, 8);
        gl.vertexAttribPointer(vLife, 1, gl.FLOAT, false, 24, 12);
        gl.vertexAttribPointer(vVelocity, 2, gl.FLOAT, false, 24, 16);
        
        gl.enableVertexAttribArray(vPosition);
        gl.enableVertexAttribArray(vAge);
        gl.enableVertexAttribArray(vLife);
        gl.enableVertexAttribArray(vVelocity);

        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, outParticlesBuffer);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, N_PARTICLES);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    }

    function swapParticlesBuffers() {
        let auxBuffer = inParticlesBuffer;
        inParticlesBuffer = outParticlesBuffer;
        outParticlesBuffer = auxBuffer;
    }

    function buildQuad() {
        const vertices = [-1.0, 1.0, -1.0, -1.0, 1.0, -1.0,
                          -1.0, 1.0,  1.0, -1.0, 1.0,  1.0];
        
        quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flatten(vertices), gl.STATIC_DRAW);

    }

    function drawQuad() {

        gl.useProgram(fieldProgram);

        // Setup attributes\
        const vPosition = gl.getAttribLocation(fieldProgram, "vPosition");

        const uScale = gl.getUniformLocation(fieldProgram, "uScale");

        gl.uniform2f(uScale, SCALE[0], SCALE[1]);

        //uniform tem 4 valores e v por ser vetor

        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(vPosition);
        gl.vertexAttribPointer(vPosition, 2, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawParticles(buffer, nParticles)
    {

        gl.useProgram(renderProgram);

        //fazer escalas

        const vPosition = gl.getAttribLocation(renderProgram, "vPosition");

        const uScale = gl.getUniformLocation(renderProgram, "uScale");

        gl.uniform2f(uScale, SCALE[0], SCALE[1]);

        // Setup attributes

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        gl.vertexAttribPointer(vPosition, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(vPosition);

        gl.drawArrays(gl.POINTS, 0, nParticles);
    }

    function drawPlanets() {

        gl.useProgram(fieldProgram);

        const count = gl.getUniformLocation(fieldProgram, "uCounter");

        for(let i=0; i<counter; i++) {
            // Get the location of the uniforms...
            const uPosition = gl.getUniformLocation(fieldProgram, "uPosition[" + i + "]");
            const uMass = gl.getUniformLocation(fieldProgram, "uMass[" + i + "]");
            // Send the corresponding values to the GLSL program
            gl.uniform2fv(uPosition, position[i]);
            gl.uniform1f(uMass, pMass[i]);
        }

        gl.uniform1i(count, counter);

    }
}

    loadShadersFromURLS([
    "field-render.vert", "field-render.frag",
    "particle-update.vert", "particle-update.frag", 
    "particle-render.vert", "particle-render.frag"
    ]
    ).then(shaders=>main(shaders));