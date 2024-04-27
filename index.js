import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as dat from 'dat.gui';
import CameraControls from 'camera-controls';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import RecordRTC, { StereoAudioRecorder } from 'recordrtc';

CameraControls.install({ THREE: THREE });

// Setup scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020)
const ambientLight = new THREE.AmbientLight(0x666666); // soft white light
scene.add(ambientLight);

// Create audio context
var audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// variables to control button states
var cameraLocked = false
var playingAudio = false
var cameraOrbiting = false
var audioLoaded = false

// Trying to figure out record and download - media stream required for this
const dest = audioCtx.createMediaStreamDestination();
dest.channelCount = 2; // Set output to stereo

// Initial recorder
let recorder = new RecordRTC(dest.stream, {
    type: 'audio',
    mimeType: 'audio/wav',
    recorderType: StereoAudioRecorder,
   // numberOfAudioChannels: 2,
   // desiredSampRate: 44100
});

let recordedBlob = null;

window.recorder = recorder;

recorder.onerror = (error) => {
    console.error('Error from MediaRecorder:', error);
};

// Setup camera
const clock = new THREE.Clock();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Setup renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Set up camera controls and constraints
const cameraControls = new CameraControls(camera, renderer.domElement);
cameraControls.enableDamping = true;
// cameraControls.dampingFactor = 0.25;
// cameraControls.minPolarAngle = 0;
cameraControls.maxPolarAngle = Math.PI / 2;
// cameraControls.maxZoom = 10;
// cameraControls.minZoom = 5;
cameraControls.maxDistance = 20;
cameraControls.minDistance = 5;

// Set initial camera position and rotation
cameraControls.setTarget(0, 0, 0);
cameraControls.setPosition(0, 5, 10);

// Save the current state as the "home" state
cameraControls.saveState();
let selectedinstrument = null; // Variable to store the selected instrument for dragging 
let dragDirection = 'horizontal'; // Determines which axis to move the instrument ( 'horizontal' | 'verital' or 'vertAll' )

const canvas = document.getElementById('spatialCanvas');

let sourcePosition = { x: canvas.width / 2, y: canvas.height / 2 }; // Initialize source position

// Load instrument models into templates we can clone on demand
const loader = new GLTFLoader();
let drumTemplate = null;
let synthTemplate = null;
let bassTemplate = null;
let padTemplate = null;

// Event listeners for mouse movement and release
let isDragging = false;

// Load instrument models
loader.load('models/drum/scene.gltf', function (gltf) {
    drumTemplate = gltf.scene;
    drumTemplate.scale.set(0.015, 0.015, 0.015); // Scale down the drum
    //console.log("Loaded drum template from model");
    // Load one initial instrument
    updateInstruments(2);

});

loader.load('models/synth/scene.gltf', function (gltf) {
    synthTemplate = gltf.scene;
    synthTemplate.scale.set(0.035, 0.035, 0.035); // Scale down the synth
    //console.log("Loaded synth template from model");
});

loader.load('models/bass/scene.gltf', function (gltf) {
    bassTemplate = gltf.scene;
    bassTemplate.scale.set(1.3, 1.3, 1.3); // Scale up the bass
    bassTemplate.rotation.x = Math.PI/1.5
    bassTemplate.rotation.y = Math.PI
    bassTemplate.rotation.z = Math.PI
    //console.log("Loaded bassTemplate from model");
});

loader.load('models/pad/scene.gltf', function (gltf) {
    padTemplate = gltf.scene;
    padTemplate.scale.set(0.6, 0.6, 0.6); // Scale down the pad
    //console.log("Loaded padTemplate from model");
});

//Load the head model
loader.load('models/head/scene.gltf', function (gltf) {
    let headTemplate = gltf.scene;
    headTemplate.scale.set(0.07, 0.07, 0.07); // Scale down the instrument
    headTemplate.position.y = 1;
    headTemplate.rotation.y = Math.PI;
    scene.add(headTemplate)

    // Set the camera looking at the head
    camera.lookAt(headTemplate.position)
});

// Create GUI
const gui = new dat.GUI();

// Recording state (one of 'idle' | 'recording' | 'saved )
let recordingState = 'idle';

// Define InstrumentCluster class
// Instrument - 3D model for this instrument
// Spotlight - lighting element for this instrument
// Panner - Panner node for this instrument's audio spatialization
// Instruments each have their own audioBuffer, audioSource, and index, but those are not set on initialization
// AudioBuffer - stores the track dropped onto an instrument
// SourceNode - Audio Context node to play and stop
// Index - unique id for the cluster
// The position of the cluster is accessed via the instrument, ie instrument.position.{x,y,z}
// This class is also where we will add per-instrument things like pitch, gain, hi/lo-pass filters, etc
class InstrumentCluster {

    constructor(instrument, spotlight, lowShelfFilter, highShelfFilter, panner) {
        this.instrument = instrument;
        this.spotlight = spotlight;

        // audio
        this.audioBuffer = null;
        this.sourceNode = null;

        // set filter types and initial corner freqs?
        this.lowShelfFilter = lowShelfFilter;
        // this.lowShelfFilter.type = "lowshelf";
        // this.lowShelfFilter.frequency.setValueAtTime(320, audioCtx.currentTime);
        this.highShelfFilter = highShelfFilter;
        // this.highShelfFilter.type = "highshelf"
        // this.highShelfFilter.frequency.setValueAtTime(3200, audioCtx.currentTime);

        // binaural
        this.panner = panner;

        this.index = null;
        this.startTime = null;
        this.offset = null;
        this.glowing = false;
        this.heightColor = null; // Color for visual feedback of semitones
    }
}

// Array to hold clusters of instruments (the above class)
const instrumentClusters = [];

// GUI parameters object
const guiParams = {
    numInstruments: 2, // Initial number of instruments
    orbitSpeed:25 // Initial orbit speed of 10%
};

// Add controls for the number of instruments
const numInstrumentsControl = gui.add(guiParams, 'numInstruments', 1, 4, 1).name('Instruments').onChange(value => {
    updateInstruments(value);
});

var orbitSpeed = 0.0025;
// Add orbit speed control from 0 to 100 (on change will scale it down by 100)
gui.add(guiParams, 'orbitSpeed', 0, 100).name('Orbit Speed').onChange(value => {
    orbitSpeed = value / 5000;
});

// Function to remove folder from GUI 
dat.GUI.prototype.removeFolder = function (name) {
    var folder = this.__folders[name];
    if (!folder) {
        return;
    }
    folder.close();
    this.__ul.removeChild(folder.domElement.parentNode);
    delete this.__folders[name];
    this.onResize();
}

// Function to update the number of instruments
function updateInstruments(numInstruments) {

    // Stop audio tracks if they are playing
    if (playingAudio) {
        stopAudio();
        playingAudio = false;
        // Reset the play button
        const playButton = document.getElementById('play-button');
        const img = playButton.querySelector('img');
        img.src = 'icons/play-button-arrowhead.png';
    }

    // Remove existing instruments and spotlights if they are less than numInstruments
    instrumentClusters.forEach(cluster => {
        scene.remove(cluster.instrument);
        scene.remove(cluster.spotlight.target);
        scene.remove(cluster.spotlight);

        // Remove the folder associated with this spotlight
        const folderName = `Instrument ${cluster.index + 1}`;
        if (gui.__folders[folderName]) {
            gui.removeFolder(folderName);
        }
    });

    instrumentClusters.length = 0;

    // Add new instruments and spotlights in a circle around the center of the stage
    const angleIncrement = (2 * Math.PI) / numInstruments;
    const radius = 5;

    // Create instruments in a circle around the stage
    for (let i = 0; i < numInstruments; i++) {
        const angle = i * angleIncrement;
        const x = radius * Math.cos(angle);
        const z = radius * Math.sin(angle);

        // Create an instrument to be represented by a 3D model
        let instrument = null;

        // Add spotlight above each instrument
        let spotlight = new THREE.SpotLight(0xffffff, 2); // Cone spotlight 
        spotlight.position.set(x * 2.5, 4, z * 2.5); // Position outside the stage
        spotlight.target.position.set(x, 0, z); // Direct light towards the instrument
        scene.add(spotlight.target); // Add spotlight target to the scene
        scene.add(spotlight); // Add spotlight to the scene

        // Each instrument will have a unique 3D model and audio track
        let track = null;

        // Assign complementary colors to spotlights unique for each instrument
        switch (i % 4) {
            case 2:
                spotlight.color.set(0x00ffff); // Cyan spotlight
                instrument = drumTemplate.clone(); // Drum
                track = 'audio/beat.wav'
                break;

            case 0:
                spotlight.color.set(0xff00ff); // Magenta spotlight
                instrument = synthTemplate.clone(); // Synth
                track = 'audio/melody.wav'
                break;

            case 1:
                spotlight.color.set(0xcc0000); // Pink spotlight
                instrument = padTemplate.clone(); // Pad
                track = 'audio/pad.wav'
                break;

            case 3:
                spotlight.color.set(0x0000ff); // Blue spotlight
                instrument = bassTemplate.clone(); // Bass
                track = 'audio/bass.wav'
                break;
        }

        // Default spotlight settings
        spotlight.intensity = 60;
        spotlight.angle = 0.4;
        spotlight.penumbra = 0.2;

        // Set the position of the 3D model
        instrument.position.set(x, 1, z); // Set position for this instrument instance
        scene.add(instrument); // Add instrument instance to the scene

        // Add userData to mark instrument as draggable
        instrument.userData.draggable = true;

        // Create controls for this spotlight
        createOrUpdateSpotlightControls(spotlight, i);

        // Create an audio buffer, filter and panner node for this instrument
        let lowShelfFilter = audioCtx.createBiquadFilter();
        lowShelfFilter.type = "lowshelf";
        lowShelfFilter.frequency.setValueAtTime(320, audioCtx.currentTime);

        let highShelfFilter = audioCtx.createBiquadFilter();
        highShelfFilter.type = "highshelf";
        highShelfFilter.frequency.setValueAtTime(3200, audioCtx.currentTime);

        let panner = audioCtx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.setPosition(instrument.position.x, instrument.position.z, instrument.position.y); // Position the audio source to the instrument position

        // Set init pos to center
        panner.orientationX.setValueAtTime(0, audioCtx.currentTime);
        panner.orientationY.setValueAtTime(0, audioCtx.currentTime);
        panner.orientationZ.setValueAtTime(0, audioCtx.currentTime);

        //console.log('At time of insertion, instrument is ' + JSON.stringify(instrument))
        const instrumentCluster = new InstrumentCluster(instrument, spotlight, lowShelfFilter, highShelfFilter, panner); // Create instrumentCluster instance
        instrumentCluster.index = i;

        instrumentClusters.push(instrumentCluster); // Push to clusters array

        // Fetch the wav file in 'track' and convert it to a blob
        fetch(track)
            .then(response => response.blob())
            .then(blob => {
                // Load the audio buffer to the instrument
                loadAudioToInstrument(instrumentCluster, blob);
            })
            .catch(error => console.error('Error:', error));

    }

    document.getElementById('shift-icon').classList.remove('emphasized');
    document.getElementById('z-icon').classList.remove('emphasized');
    document.getElementById('shift-icon').classList.remove('super');
    document.getElementById('z-icon').classList.remove('super');
}

// Creates or updates spotlight controls and adds them to the UI
function createOrUpdateSpotlightControls(spotlight, index) {
    // Check if the folder exists, if it does, update the controls
    let folder = gui.addFolder(`Instrument ${index + 1}`);

    // Add controls for color
    const colorControl = folder.addColor({
        color: spotlight.color.getHex()
    }, 'color').name('Color').onChange(value => {
        spotlight.color.set(value);
    });

    folder.open(); // Open the folder by default
}

// Add stage
const stageGeometry = new THREE.CylinderGeometry(9, 9, 1, 32);
const stageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, emissiveIntensity: .01 }); // Use MeshStandardMaterial with lower emissive intensity
stageMaterial.emissive = new THREE.Color(0xffffff);
const stage = new THREE.Mesh(stageGeometry, stageMaterial);
stage.isDraggable = false;
scene.add(stage);

// Lower the stage a little so the models are on top of it
stage.position.y = -0.75;

// Directional arrows
// Create arrow helpers
const arrowDirections = {
    up: new THREE.Vector3(0, 1, 0),
    down: new THREE.Vector3(0, -1, 0),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    backward: new THREE.Vector3(0, 0, -1)
};

const arrowHelpers = {};

for (const [direction, vector] of Object.entries(arrowDirections)) {
    const arrow = new THREE.ArrowHelper(vector, new THREE.Vector3(), 1.5, 0xffffff, 0.5, 0.5);
    arrow.visible = false;
    scene.add(arrow);
    arrowHelpers[direction] = arrow;
}

var orbitButtonRotation = 0;
// Update function
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    cameraControls.update(delta);

    // If the camera is orbiting, automatically rotate the camera around the center of the stage
    if (cameraOrbiting && !isDragging) {
        cameraControls.rotate(orbitSpeed, 0, true);

        // Increment the rotation angle
        orbitButtonRotation += 0.01;

        // Spin the orbitting icon
        document.getElementById('orbit-button').style.transform = `rotate(${orbitButtonRotation}rad)`;

        // Update the position of the instrument clusters so they orbit around the center of the stage
        instrumentClusters.forEach(cluster => {
            const angle = Math.atan2(cluster.instrument.position.z, cluster.instrument.position.x) - orbitSpeed;
            const radius = Math.sqrt(cluster.instrument.position.x ** 2 + cluster.instrument.position.z ** 2);
            cluster.instrument.position.x = radius * Math.cos(angle);
            cluster.instrument.position.z = radius * Math.sin(angle);

            // Update spotlight target position (TODO only if what we are moving is an instrument and not the listener object)
            const spotlight = cluster.spotlight;
            spotlight.target.position.copy(cluster.instrument.position);

        });
    }

    // 3D Arrow helpers
    if (isDragging) {
        if (dragDirection == 'horizontal') {
            // If shift is not held, show left, right, forward, and backward arrows
            for (const direction of ['left', 'right', 'forward', 'backward']) {
                arrowHelpers[direction].position.copy(selectedinstrument.position);
                arrowHelpers[direction].visible = true;
                arrowHelpers.up.visible = false;
                arrowHelpers.down.visible = false;

                document.getElementById('shift-icon').classList.remove('super');
                document.getElementById('z-icon').classList.remove('super');
            }
        } else if (dragDirection == 'vertical' || dragDirection == 'vertAll') {
            // If shift is held, show up and down arrows
            arrowHelpers.up.position.copy(selectedinstrument.position);
            arrowHelpers.down.position.copy(selectedinstrument.position);
            arrowHelpers.up.visible = true;
            arrowHelpers.down.visible = true;
            for (const direction of ['left', 'right', 'forward', 'backward']) {
                arrowHelpers[direction].visible = false;
            }
        }
    } else {
        for (const arrow of Object.values(arrowHelpers)) {
            arrow.visible = false;
        }
    }

    renderer.render(scene, camera);
    updateParameters();

}



animate();


// Mouse click initial handler
document.addEventListener('mousedown', function (event) {
    event.preventDefault();
    const mouse = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: - (event.clientY / window.innerHeight) * 2 + 1
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const draggableObjects = instrumentClusters.map(cluster => cluster.instrument);
    //console.log(JSON.stringify(draggableObjects,null,4))
    const intersects = raycaster.intersectObjects(draggableObjects);
    if (intersects.length > 0) {
        //console.log(JSON.stringify(intersects,null,4))
        isDragging = true;
        selectedinstrument = intersects[0].object;
        while (selectedinstrument.parent.parent !== null) {
            selectedinstrument = selectedinstrument.parent;
        }
        cameraControls.enabled = false; // Disable OrbitControls while dragging
        const spotlight = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument).spotlight;
        spotlight.intensity = spotlight.intensity * 4;
        document.getElementById('shift-icon').classList.add('emphasized');
        document.getElementById('z-icon').classList.add('emphasized');

    }
});

// Mouse dragging
document.addEventListener('mousemove', function (event) {
    event.preventDefault();
    if (isDragging && selectedinstrument) {
        const mouse = {
            x: (event.clientX / window.innerWidth) * 2 - 1,
            y: - (event.clientY / window.innerHeight) * 2 + 1
        };
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        // Create a plane for intersection
        const plane = new THREE.Plane();
        if (dragDirection == 'horizontal') {
            plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), selectedinstrument.position);
        } else {
            // For vertical movement, use a plane perpendicular to the camera's viewing direction
            plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), selectedinstrument.position);
        }

        // Calculate intersection of raycaster and plane
        const intersectionPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersectionPoint);

        // Handle movement based on key modifier
        if (dragDirection == 'horizontal') {
            const stageRadius = stage.geometry.parameters.radiusTop;
            const distanceFromCenter = intersectionPoint.distanceTo(stage.position);
            if (distanceFromCenter <= stageRadius) {
                selectedinstrument.position.x = intersectionPoint.x;
                selectedinstrument.position.z = intersectionPoint.z;
            }
        } 
        else if (dragDirection == 'vertical') {
            // Set instrument y position to intersection y position
            const newHeight = intersectionPoint.y;

            // Ensure it's not below the stage
            const minHeight = heightMin;
            if (newHeight >= minHeight && newHeight <= heightMax) {
                selectedinstrument.position.y = intersectionPoint.y;
            }

        } 
        else if (dragDirection == 'vertAll') {
            // Move ALL instruments to the same height as this one
            const newHeight = intersectionPoint.y;

            // Ensure it's not below the stage
            const minHeight = heightMin;
            if (newHeight >= minHeight && newHeight <= heightMax) {
                // Iterate on all instruments
                instrumentClusters.forEach(cluster => {
                    cluster.instrument.position.y = newHeight;
                });
            }
        }

        // Update spotlight target position 
        const pickedInstrument = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument);
        if (pickedInstrument && pickedInstrument.spotlight != null) {
            pickedInstrument.spotlight.target.position.copy(selectedinstrument.position);
        } 
        else {
            return;
        }

        if (event.shiftKey) {
            addVerticalLine();
        }

        updateParameters();
    }
});

// Drop the instrument
document.addEventListener('mouseup', function (event) {
    event.preventDefault();
    if (isDragging && selectedinstrument != null && instrumentClusters) {
        isDragging = false;

        // Re-enable Camera controls if they are unlocked
        cameraControls.enabled = !cameraLocked;
        const pickedInstrument = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument);
        if (pickedInstrument && pickedInstrument.spotlight) {
            const spotlight = instrumentClusters.find(cluster => cluster && cluster.instrument === selectedinstrument).spotlight;
            spotlight.intensity = spotlight.intensity / 4;
        } 
        else {
            return;
        }
        selectedinstrument = null; // Deselect the instrument
        document.getElementById('shift-icon').classList.remove('emphasized');
        document.getElementById('z-icon').classList.remove('emphasized');
        document.getElementById('shift-icon').classList.remove('super');
        document.getElementById('z-icon').classList.remove('super');
    }
});

let verticalLine;

function removeVerticalLine() {
    if (verticalLine) {
        scene.remove(verticalLine);
        verticalLine.geometry.dispose();
        verticalLine.material.dispose();
        verticalLine = undefined;
    }
}

// This draws a vertical line from the selected instrument to the stage (and beyond) to indicate the semitone value
function addVerticalLine() {
    if (selectedinstrument) {
        if (verticalLine) removeVerticalLine()

            const height = selectedinstrument.position.y;
            const semitone = scaleValue(height, heightStart, heightMax, semitoneMin, semitoneMax); // Map height to semitones
            const roundedSemitone = Math.round(semitone)

            // Calculate hue value
            const hue = (roundedSemitone * (360 / semitoneMax)) % 360;

            const material = new LineMaterial({
            color: new THREE.Color().setHSL(hue / 360, 1, 0.5),
                linewidth: 15,
                resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
            });
    
            const points = [];
            points.push(new THREE.Vector3(selectedinstrument.position.x, -50, selectedinstrument.position.z));
            points.push(new THREE.Vector3(selectedinstrument.position.x, 50, selectedinstrument.position.z));
            
            if (points.length >= 2) {
                const geometry = new LineGeometry();
                let positions = points.map(p => [p.x, p.y, p.z]).flat();

                geometry.setPositions(positions);
            
                verticalLine = new Line2(geometry, material);
                verticalLine.computeLineDistances();
                scene.add(verticalLine);
            } else {
                //console.log("You dont have enough points :(")
            }
    }
}

// Shift key modifier
document.addEventListener('keydown', function (event) {
    if (isDragging) {
        if (event.key == "Shift") {
            dragDirection = 'vertical';
            addVerticalLine();
            document.getElementById('shift-icon').classList.add('super');
        }

        if (event.key == "a") {
            dragDirection = 'vertAll';
            addVerticalLine();
            document.getElementById('z-icon').classList.add('super');
        }
    }
});

// Shift key modifier
document.addEventListener('keyup', function (event) {
    if (event.key == "Shift") {
        dragDirection = 'horizontal';
        removeVerticalLine();
    }

    if (event.key == "a") {
        dragDirection = 'horizontal';
        removeVerticalLine();
    }
});

// Constants for semitone and associated colors
const semitoneMax = 24
const semitoneMin = 0
const heightMax = 4
const heightStart = 1
const heightMin = 0

// Update a each panner's position - renamed to updateParameters()
function updateParameters() {
    const rect = canvas.getBoundingClientRect();

    instrumentClusters.forEach(cluster => {

        let transitionTime = 0.1;
        let currentTime = audioCtx.currentTime;

        // 2d euclidean distance 
        const distanceFromCenter = Math.sqrt(cluster.instrument.position.x ** 2 + cluster.instrument.position.z ** 2);

        // needs to be fine tuned
        const maxDistance = Math.sqrt((rect.width / 2) ** 2 + (rect.height / 2) ** 2);

        // scale filter cutoff based on distance from center of stage
        const lowShelfFrequency = scaleLog(distanceFromCenter, 0, maxDistance / 2, 20, 2000);
        const highShelfFrequency = scaleLog(distanceFromCenter, 0, maxDistance / 2, 2000, 10000);

        // frequencies based on distance
        cluster.lowShelfFilter.frequency.linearRampToValueAtTime(lowShelfFrequency, currentTime + transitionTime);
        cluster.highShelfFilter.frequency.linearRampToValueAtTime(highShelfFrequency, currentTime + transitionTime);

        // y position for playback speed
        const height = cluster.instrument.position.y;
        const semitone = scaleValue(height, heightStart, heightMax, semitoneMin, semitoneMax);
        const roundedSemitone = Math.round(semitone)
        const playbackSpeed = Math.pow(2, roundedSemitone/12);
        ////console.log("Height: " + height + " raw semitone: " + semitone + " rounded semitone: " + roundedSemitone + " speed: " + playbackSpeed);

        if (!cluster.sourceNode) {
            // //console.log("Source node not found for cluster: " + cluster.index + ". Skipping...");
            return;
        }

        // playback speed
        cluster.sourceNode.playbackRate.linearRampToValueAtTime(playbackSpeed, audioCtx.currentTime + 0.1);

        // pan
        cluster.panner.positionX.linearRampToValueAtTime(cluster.instrument.position.x, currentTime + transitionTime);
        cluster.panner.positionY.linearRampToValueAtTime(cluster.instrument.position.z, currentTime + transitionTime); // Assuming Y is up and you want to use Z here
        cluster.panner.positionZ.linearRampToValueAtTime(cluster.instrument.position.y, currentTime + transitionTime); // Assuming Z is forward/backward

    });

}

//scale param values
function scaleValue(input, inputStart, inputEnd, outputStart, outputEnd) {
    return outputStart + ((input - inputStart) / (inputEnd - inputStart)) * (outputEnd - outputStart);
}

function scaleLog(input, inputStart, inputEnd, outputStart, outputEnd) {
    input = Math.max(input, inputStart);

    var fraction = (input - inputStart) / (inputEnd - inputStart);
    var logScaleOutput = outputStart * (outputEnd / outputStart) ** fraction;

    return logScaleOutput;
}


// Play button
function playAudio() {
    // Iterate through the instruments and play a track for each one that has a valid audio buffer
    instrumentClusters.forEach(cluster => {
        if (cluster.audioBuffer && cluster.sourceNode) {
            cluster.sourceNode.start();
        }
    });
}

// Stop button
function stopAudio() {

    // Iterate through the instruments and stop the track for each one if it is playing
    instrumentClusters.forEach(cluster => {
        if (cluster.sourceNode) {
            cluster.sourceNode.stop();

            // Since audio buffers can only be stopped once, use the saved file on the instrument to reload the audio file to this instrument
            if (cluster.savedFile) {
                loadAudioToInstrument(cluster, cluster.savedFile);
            }
        }
    });
}

// Prevent drag across the screen from loading file into the browser
document.addEventListener('dragover', function (ev) {
    ev.preventDefault();
});

// Load audio URL to given instrument
function fetchAudio(url) {
    let file = null;
    // Fetch the URL and return as a array buffer
    fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => {
            file = new Blob([arrayBuffer], { type: 'audio/wav' });
        });
    return file;
}

// Drop audio file onto the scene 
document.addEventListener('drop', function (ev) {
    ev.preventDefault();

    // Get mouse position relative to screen
    const mouse = {
        x: (ev.clientX / window.innerWidth) * 2 - 1,
        y: - (ev.clientY / window.innerHeight) * 2 + 1
    }

    // Create a ray cast from camera, through mouse, into the scene
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const draggableObjects = instrumentClusters.map(cluster => cluster.instrument);

    // Get objects instersected by our mouse curser ray cast
    const intersectedObjects = raycaster.intersectObjects(draggableObjects);
    if (intersectedObjects.length > 0) {

        // Get the 3D point of the first object intersected
        let intersectedObject = intersectedObjects[0].object;
        // Since the models are made of parts, iterate up their hierarchy to the top level object
        while (intersectedObject.parent.parent !== null) {
            intersectedObject = intersectedObject.parent;
        }

        // Now, we have our 3D Object that we have hit. We just need to match it with an instrument from the cluster, 
        // and then we can load the audio buffer to the instrument
        instrumentClusters.forEach(cluster => {
            if (intersectedObject.position == cluster.instrument.position) {
                // Bingo, we are dropping a file onto THIS cluster
                if (ev.dataTransfer.items) {
                    //console.log(ev)
                    var file = ev.dataTransfer.items[0].getAsFile();
                    loadAudioToInstrument(cluster, file);

                    // Blink the spotlight twice to indicate that the audio has been loaded to THIS instrument
                    const spotlight = cluster.spotlight;
                    spotlight.intensity = 60;
                    setTimeout(() => {
                        spotlight.intensity = 2;
                    }, 500);
                    setTimeout(() => {
                        spotlight.intensity = 60;
                    }, 1000);
                    setTimeout(() => {
                        spotlight.intensity = 2;
                    }, 1500);
                    setTimeout(() => {
                        spotlight.intensity = 60;
                    }, 2000);

                }
            }

        });
    }
});

function loadAudioToInstrument(instrument, file) {
    var reader = new FileReader();
    reader.onload = function (file) {
        //console.log("Here is instrument in file load: " + instrument)
        audioCtx.decodeAudioData(file.target.result, function (buffer) {
            //console.log("Here is cluster in buffer load: " + instrument)
            instrument.sourceNode = audioCtx.createBufferSource();
            instrument.audioBuffer = buffer;
            instrument.sourceNode.buffer = instrument.audioBuffer;

            instrument.sourceNode.loop = true;

            // We need to figure out the best way to listen and scale each object's vertical value for playback speed
            var playbackSpeed = 1;//document.getElementById('').value;
            instrument.sourceNode.playbackRate.value = playbackSpeed;

            instrument.sourceNode.connect(instrument.lowShelfFilter);
            instrument.lowShelfFilter.connect(instrument.highShelfFilter);
            instrument.highShelfFilter.connect(instrument.panner);
            instrument.panner.connect(dest);
            instrument.panner.connect(audioCtx.destination);

            // Set parameters
            updateParameters();

        })

    };
    reader.readAsArrayBuffer(file);

    // Keep the file around to recreate the audio buffer if needed (for starting and stopping)
    instrument.savedFile = file;
}

// Transport controls
document.getElementById('play-button').addEventListener('click', () => {
    // If the audio is already playing, stop it
    if (playingAudio) {
        stopAudio();
        playingAudio = false;
    } else {
        playAudio();
        playingAudio = true;
    }

    // Set the icon based on the state
    const button = document.getElementById('play-button');
    const img = button.querySelector('img');
    img.src = playingAudio ? 'icons/stop-button.png' : 'icons/play-button-arrowhead.png';

});

// Camera lock button
document.getElementById('lock-button').addEventListener('click', () => {
    cameraLocked = !cameraLocked;
    cameraOrbiting = false;
    cameraControls.enabled = !cameraLocked;
    const button = document.getElementById('lock-button');
    const img = button.querySelector('img');
    img.src = cameraLocked ? 'icons/secured-lock.png' : 'icons/padlock-unlock.png';
});

// Camera orbit button
document.getElementById('orbit-button').addEventListener('click', () => {
    cameraOrbiting = !cameraOrbiting && !cameraLocked;
});

// Camera home button
document.getElementById('home-button').addEventListener('click', () => {
    // Set the camera to the original position
    cameraControls.reset(true);
    cameraOrbiting = false;
    cameraLocked = false;
    const button = document.getElementById('lock-button');
    const img = button.querySelector('img');
    img.src = 'icons/padlock-unlock.png';
    cameraControls.enabled = true;
});

window.onload = function () {
    document.getElementById('info-button').classList.add('flash');
};



document.addEventListener('DOMContentLoaded', function () {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalDialog = document.getElementById('modal-dialog');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');  // Assuming a cancel button exists
    const continueBtn = document.getElementById('modal-continue');  // Assuming a continue button exists
    const messageParagraph = document.getElementById('modal-message');

    window.showModal = function (message, onConfirm, useContinueOnly = false) {
        messageParagraph.innerHTML = message;  // Set the HTML content

        // Adjust visibility of buttons based on the context
        if (useContinueOnly) {
            confirmBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            continueBtn.style.display = 'block';
            continueBtn.onclick = function () {
                closeModal();
            };
        } else {
            confirmBtn.style.display = 'block';
            cancelBtn.style.display = 'block';
            continueBtn.style.display = 'none';
            confirmBtn.onclick = function () {
                if (typeof onConfirm === "function") {
                    onConfirm();  // Execute the confirm callback if it's a function
                }
                closeModal();  // Close the modal after confirmation
            };
        }

        modalBackdrop.style.display = 'block';
        modalDialog.style.display = 'block';
    };

    window.closeModal = function () {
        modalBackdrop.style.display = 'none';
        modalDialog.style.display = 'none';
    };

    const downloadButton = document.getElementById('download-button');
    if (downloadButton) {
        downloadButton.addEventListener('click', function () {
            if (recordedBlob == null) {
                alert("No recording available to download. If you just ended a recording, please wait a few seconds and try again.");
                return;
            }
            window.showModal("Your audio recording is ready for download. Please confirm.", function () {
                const url = URL.createObjectURL(recordedBlob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'recording.wav';  // Change to .webm to match the MIME type
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, false);
        });
    }

    const clearButton = document.getElementById('clear-button');
    if (clearButton) {
        clearButton.addEventListener('click', function () {
            if (recordingState !== 'saved' && recordedBlob == null) {
                alert("No recording available to delete. Please try recording something.");
                return;
                //console.log("No recording to delete.");
                return;
            }
            window.showModal("Are you sure you want to delete your recording?", function () {
                recordedBlob = null;  // Clear the recorded data
                recordingState = 'idle';
                const recordButton = document.getElementById('record-button');
                recordButton.className = 'idle';
                //console.log("Recording deleted.");
            }, false);
        });
    }

    document.getElementById('info-button').addEventListener('click', () => {
        // Show the modal with informational text
        const infoMessage = `<div id="modal-instructions" class="modal-instructions">
        <h1>3D Stage by Grinchester Games</h1>
        <p>Welcome to the Spatial Audio Mixer! Drag and drop audio files onto the instruments to load them, or use the default samples. Move the instruments around to spatialize the audio. Click and drag the stage to adjust the camera. Use the play button to start the audio, which can be recorded and downloaded. Enjoy!</p>
        <h2>3D Stage - Detailed User Instructions</h2>
        <p><strong>Setup Instructions:</strong></p>
        <ol>
            <li>Set the number of desired instruments using the slider located in the top-right of the user interface.</li>
            <li>3D models representing individual audio tracks will load in based on the slider. Each model has a default audio track.</li>
            <li>You can use the sample track, or drop a <code>.wav</code> or <code>.mp3</code> file directly onto each individual instrument model to mix your own audio.</li>
            <li>Once all audio samples have been loaded onto their respective instrument icons, click the playback button on the transport.</li>
            <li>Once you’ve dialed in your instruments, you can record and download your mix using the record and download buttons on the transport.</li>
        </ol>
        <p><strong>Instrument and Scene Manipulation:</strong></p>
        <ul>
            <li>Click and drag the mouse on a 3D instrument model to move it around the scene. This will control the spatialization of that instrument's audio track.</li>
            <li>While dragging, hold the 'shift' key to raise the instrument up or lower it down, which will adjust the pitch of the track. Hold the 'a' key to adjust all instruments at once. </li>
            <li>On the top left of the screen you can reset scene by clicking the reload button. </li>
            <li>Each spotlight can have a custom color, which can be set via the corresponding color picker in the top right. </li>
        </ul>
        <p><strong>Camera Controls:</strong></p>
        <ul>
            <li>Click and drag the mouse across the screen to rotate the camera around the stage.</li>
            <li>Use the mouse wheel to zoom in and out of the scene.</li>
            <li>On the bottom left, you can use various camera controls to lock the camera, orbit the camera automatically (for a fun stereo experience!), or reset the camera.</li>
            <li>Orbit speed can be adjusted via the slider in the top right of the screen. </li>
        </ul>
        <p><strong>Prerequisites for User Audio Samples:</strong></p>
        <ul>
            <li>Audio files should be recorded at the <strong>same samplerate</strong> to ensure matched repitching between elements based on their assigned color.</li>
            <li>Audio files should be the <strong>same length</strong> to ensure synchronicity between samples when they playback and repeat (loop).</li>
            <li>To play your downloaded audio file, you will need a tool to provide the correct audio codes. Check out the following tools for more:</li>
            <li> ffmpeg: <a href="https://ffmpeg.org/" target="_blank">https://ffmpeg.org/</a></li>
            <li> Audacity: <a href="https://www.audacityteam.org/" target="_blank">https://www.audacityteam.org/</a></li>
            <li> VLC Media Player: <a href="https://www.videolan.org/vlc/index.html" target="_blank">https://www.videolan.org/vlc/index.html</a></li>
        </ul>
    </div>
    `;
        window.showModal(infoMessage, null, true);  // true means we use the "Continue" button only
        document.getElementById('info-button').classList.remove('flash');

    });

    document.getElementById('about-button').addEventListener('click', () => {
        const aboutMessage = `        
        <strong>3D Stage is created by:</strong>
        <table style="width:100%; text-align:center; border:1px solid white;">
        <tr>
            <th>Grinchester Games</th>
        </tr>
        <tr>
            <td>Richard Graham, Ph.D.</td>
        </tr>
        <tr>
            <td>Matthew Winchester</td>
        </tr>
        <tr>
            <td>The George Washington University</td>
        </tr>
        </table>
        <strong>Check out our code here:<a href="https://github.com/latterArrays/3DStage" target="_blank"> Github </a></strong> 
        <h3>Attributions:</h3>
        <strong>Icons:</strong>
        <ul>
            <li>Circular arrow icons created by <a href="https://www.flaticon.com/free-icons/circular-arrow" target="_blank">Dave Gandy - Flaticon</a></li>
            <li>Spinning icons created by <a href="https://www.flaticon.com/free-icons/spinning" target="_blank">Andrejs Kirma - Flaticon</a></li>
            <li>Lock icons created by <a href="https://www.flaticon.com/free-icons/lock" target="_blank">Dave Gandy - Flaticon</a> and <a href="https://www.flaticon.com/free-icons/lock" target="_blank">Freepik - Flaticon</a></li>
            <li>Homepage icons created by <a href="https://www.flaticon.com/free-icons/homepage" target="_blank">Aldo Cervantes - Flaticon</a></li>
            <li>Stop button icons created by <a href="https://www.flaticon.com/free-icons/stop-button" target="_blank">SumberRejeki - Flaticon</a></li>
            <li>Save icons created by <a href="https://www.flaticon.com/free-icons/save" target="_blank">Bharat Icons - Flaticon</a></li>
            <li>Trash can icons created by <a href="https://www.flaticon.com/free-icons/trash-can" target="_blank">Freepik - Flaticon</a></li>
            <li>Record icons created by <a href="https://www.flaticon.com/free-icons/record" target="_blank">Andrean Prabowo - Flaticon</a></li>
            <li>Cinema icons created by <a href="https://www.flaticon.com/free-icons/cinema" target="_blank">Kiranshastry - Flaticon</a></li>
            <li>Shift icons created by <a href="https://www.flaticon.com/free-icons/shift" target="_blank">Freepik - Flaticon</a></li>
            <li>Question icons created by <a href="https://www.flaticon.com/free-icons/question" target="_blank">Freepik - Flaticon</a></li>
            <li>Info icons created by <a href="https://www.flaticon.com/free-icons/info" target="_blank">Freepik - Flaticon</a></li>
        </ul>
        <strong>Models:</strong>
        <ul>
            <li>"Bass Guitar Low Poly Freebie" by Geug is licensed under Creative Commons Attribution <a href="https://skfb.ly/6SPER" target="_blank">https://skfb.ly/6SPER</a></li>
            <li>"Oversized Drum Pad" by lukus1 is licensed under Creative Commons Attribution <a href="https://skfb.ly/6YTGQ" target="_blank">https://skfb.ly/6YTGQ</a></li>
            <li>"Synth Keyboard mini" by modE is licensed under Creative Commons Attribution <a href="https://skfb.ly/6nWVQ" target="_blank">https://skfb.ly/6nWVQ</a></li>
            <li>"Tribal Drum (Free)" by wolfgar74 is licensed under Creative Commons Attribution <a href="https://skfb.ly/6XQSs" target="_blank">https://skfb.ly/6XQSs</a></li>
            <li>"Basic Planes of the Head (Andrew Loomis)" by Shape Foundations is licensed under CC Attribution-NonCommercial-ShareAlike <a href="https://skfb.ly/6QUv6" target="_blank">https://skfb.ly/6QUv6</a></li>
        </ul>
        <strong>Software libraries:</strong>
        <ul>
            <li>Three.js <a href="https://threejs.org/" target="_blank">https://threejs.org/</a></li>
            <li>Web Audio API <a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API" target="_blank">https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API</a></li>
            <li>Camera Controls <a href="https://www.npmjs.com/package/camera-controls" target="_blank">https://www.npmjs.com/package/camera-controls</a></li>
        </ul>`;  // Your about message HTML content

        window.showModal(aboutMessage, null, true);  // true means we use the "Continue" button only
    });
});

// Reset button
document.getElementById('reset-instruments').addEventListener('click', () => {
    // Reset via the number of instruments
    updateInstruments(guiParams.numInstruments);
    //console.log("Instruments reset");
});

const recordButton = document.getElementById('record-button');

// Toggle recording state when the button is clicked
recordButton.addEventListener('click', function () {
    switch (recordingState) {
        case 'idle':
        case 'saved':
            recordingState = 'recording';
            this.className = 'recording';
            this.title = "Stop Audio Recording"
            recordedBlob = null; // Reset the chunks array

            // Create a new RecordRTC instance
            recorder = new RecordRTC(dest.stream, {
                type: 'audio',
                mimeType: 'audio/wav',
                recorderType: StereoAudioRecorder,
                //numberOfAudioChannels: 2,
                //desiredSampRate: 44100
            });

            recorder.startRecording();
            //console.log("start recording");

            break;
        case 'recording':

            recordingState = 'saved';
            this.className = 'saved';

            // To stop recording
            recorder.stopRecording(function() {
                recordedBlob = recorder.getBlob();
            });
            this.title = "Start Audio Recording"

            break;
    }
});




