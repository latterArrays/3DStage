import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as dat from 'dat.gui';

// Setup scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020)
const ambientLight = new THREE.AmbientLight(0x666666); // soft white light
scene.add(ambientLight);

// Create audio context
var audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Setup camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 0); // TODO Fix initial position

// Setup renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Setup controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.update();

let selectedinstrument = null; // Variable to store the selected instrument for dragging 
let dragDirection = 'horizontal'; // Determines which axis to move the instrument ( 'horizontal' | 'verital' )

const canvas = document.getElementById('spatialCanvas');

// TODO create a model for the source position, similar to the isntrumentCluster class but not audio node or buffer or panner
let sourcePosition = { x: canvas.width / 2, y: canvas.height / 2 }; // Initialize source position

// Load instrument models (just the drum for now)
const loader = new GLTFLoader();
let drumTemplate = null;
let synthTemplate = null;
let bassTemplate = null;
let padTemplate = null;

// Load instrument models
loader.load('src/models/drum/scene.gltf', function (gltf) {
    drumTemplate = gltf.scene;
    drumTemplate.scale.set(0.015, 0.015, 0.015); // Scale down the drum
    console.log("Loaded drum template from model");
    // Load one initial instrument
    updateInstruments(1);

});

loader.load('src/models/synth/scene.gltf', function (gltf) {
    synthTemplate = gltf.scene;
    synthTemplate.scale.set(0.035, 0.035, 0.035); // Scale down the synth
    console.log("Loaded synth template from model");
});

loader.load('src/models/bass/scene.gltf', function (gltf) {
    bassTemplate = gltf.scene;
    bassTemplate.scale.set(1.3, 1.3, 1.3); // Scale up the bass
    bassTemplate.rotation.x=Math.PI/4
    bassTemplate.rotation.y=Math.PI/4
    bassTemplate.rotation.z=Math.PI/4
    console.log("Loaded bassTemplate from model");
});

loader.load('src/models/pad/scene.gltf', function (gltf) {
    padTemplate = gltf.scene;
    padTemplate.scale.set(0.6, 0.6, 0.6); // Scale down the pad
    console.log("Loaded padTemplate from model");
});

//Load the head
loader.load('src/models/head/scene.gltf', function(gltf) {
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
    constructor(instrument, spotlight, panner) {
        this.instrument = instrument;
        this.spotlight = spotlight;
        this.panner = panner;
        this.audioBuffer = null;
        this.sourceNode = null;
        this.index = null;
        this.startTime = null;
        this.offset = null;
        this.glowing = false;
    }
}

// Array to hold clusters of instruments (the above class)
const instrumentClusters = [];

// GUI parameters object
const guiParams = {
    numInstruments: 1 // Initial number of instruments
};

// Add controls for the number of instruments
const numInstrumentsControl = gui.add(guiParams, 'numInstruments', 1, 4, 1).name('Number of Instruments').onChange(value => {
    updateInstruments(value);
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

    // Stop audio tracks
    stopAudio();

    // Remove existing instruments and spotlights if they are less than numInstruments
    instrumentClusters.forEach(cluster => {
            scene.remove(cluster.instrument);
            scene.remove(cluster.spotlight.target);
            scene.remove(cluster.spotlight);

            // Remove the folder associated with this spotlight
            const folderName = `Spotlight ${cluster.index + 1}`;
            if (gui.__folders[folderName]) {
                gui.removeFolder(folderName);
            }
        
    });

    instrumentClusters.length = 0;

    // Add new instruments and spotlights in a circle around the center of the stage
    const angleIncrement = (2 * Math.PI) / numInstruments;
    const radius = 5;

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

        let track = null;
        // Assign complementary colors to spotlights unique for each instrument
        // TODO change the cloned template once you have more models
        switch (i % 4) {
            case 0:
                spotlight.color.set(0x00ffff); // Cyan spotlight
                instrument = drumTemplate.clone(); // Drum
                track = 'src/audio/beat.wav'             
                break;

            case 1:
                spotlight.color.set(0xff00ff); // Magenta spotlight
                instrument = synthTemplate.clone(); // Synth
                track = 'src/audio/melody.wav'              
                break;

            case 2:
                spotlight.color.set(0x0000ff); // Blue spotlight
                instrument = bassTemplate.clone(); // Bass
                track = 'src/audio/bass.wav'               
                break;

            case 3:
                spotlight.color.set(0xcc0000); // Pink spotlight
                instrument = padTemplate.clone(); // Pad
                track = 'src/audio/pad.wav'
                break;
        }

        // Default spotlight settings
        spotlight.intensity = 35;
        spotlight.angle = 0.4;
        spotlight.penumbra = 0.2;

        // Set the position of the 3D model
        instrument.position.set(x, 0.4, z); // Set position for this instrument instance
        scene.add(instrument); // Add instrument instance to the scene

        // Add userData to mark instrument as draggable
        instrument.userData.draggable = true;

        // Create controls for this spotlight
        createOrUpdateSpotlightControls(spotlight, i);

        // Create an audio buffer and panner node for this instrument
        let panner = audioCtx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.setPosition(instrument.position.x, instrument.position.z, instrument.position.y); // Position the audio source to the instrument position
        panner.orientationX.setValueAtTime(1, audioCtx.currentTime); // TODO assuming this needs to face the listener from where the cluster is, we'll need to modify this
        panner.orientationY.setValueAtTime(0, audioCtx.currentTime);
        panner.orientationZ.setValueAtTime(0, audioCtx.currentTime);

        //console.log('At time of insertion, instrument is ' + JSON.stringify(instrument))
        const instrumentCluster = new InstrumentCluster(instrument, spotlight, panner); // Create instrumentCluster instance
        instrumentCluster.index = i;

        instrumentClusters.push(instrumentCluster); // Push to clusters array

        // Set the initial audio buffer for the instrument
        fetch(track) // TODO fix this initial load of audio
            .then(response => response.blob())
            .then(blob => {
                loadAudioToInstrument(instrument, blob);
            });
    }
}






// Creates or updates spotlight controls and adds them to the UI
// TODO reduce the complexity of these controls once lighting is tied to other attributes of the instrument
function createOrUpdateSpotlightControls(spotlight, index) {
    // Check if the folder exists, if it does, update the controls
    let folder = gui.addFolder(`Spotlight ${index + 1}`);

    // Add controls for color
    const colorControl = folder.addColor({
        color: spotlight.color.getHex()
    }, 'color').name('Color').onChange(value => {
        spotlight.color.set(value);
    });

    folder.open(); // Open the folder by default
}



// Add stage
const stageGeometry = new THREE.CircleGeometry(9, 32);
const stageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, emissiveIntensity: .01 }); // Use MeshStandardMaterial with lower emissive intensity
stageMaterial.emissive = new THREE.Color(0xffffff);
const stage = new THREE.Mesh(stageGeometry, stageMaterial);
stage.rotation.x = -Math.PI / 2; // Rotate to lay flat on the ground
stage.isDraggable = false;
scene.add(stage);


// Update function
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

animate();

// Event listeners for mouse movement and release
let isDragging = false;

// Mouse click initial handler
document.addEventListener('mousedown', function (event) {
    event.preventDefault();
    const mouse = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: - (event.clientY / window.innerHeight) * 2 + 1
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    console.log(instrumentClusters.length)
    //console.log(JSON.stringify(instrumentClusters,null,4))

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
        controls.enabled = false; // Disable OrbitControls while dragging
        const spotlight = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument).spotlight;
        spotlight.intensity = spotlight.intensity * 4;
        document.getElementById('shift-icon').classList.add('emphasized');

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

        const intersects = raycaster.intersectObject(stage);
        if (intersects.length > 0) {
            const intersectionPoint = intersects[0].point;

            // Handle movement based on key modifier
            if (dragDirection == 'horizontal') {
                selectedinstrument.position.x = intersectionPoint.x;
                selectedinstrument.position.z = intersectionPoint.z;
            } else if (dragDirection == 'vertical') {
                // Calculate displacement along the vertical axis using Pythagorean theorem
                var deltaX = intersectionPoint.x - selectedinstrument.position.x;
                var deltaZ = intersectionPoint.z - selectedinstrument.position.z;
                var displacement = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
                selectedinstrument.position.y = displacement; 
           }


            // Update spotlight target position (TODO only if what we are moving is an instrument and not the listener object)
            const spotlight = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument).spotlight;
            spotlight.target.position.copy(intersectionPoint);

            if (event.shiftKey) {
                addVerticalLine();
            }
        }

        // Update audio panners to reflect new positions
        updatePanners();
    }
});

// Drop the instrument
document.addEventListener('mouseup', function (event) {
    event.preventDefault();
    if (isDragging) {
        isDragging = false;
        controls.enabled = true; // Re-enable OrbitControls
        const spotlight = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument).spotlight;
        spotlight.intensity = spotlight.intensity / 4;
        selectedinstrument = null; // Deselect the instrument
        document.getElementById('shift-icon').classList.remove('emphasized');

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

function addVerticalLine() {
    if(selectedinstrument) {
        if(verticalLine) removeVerticalLine()

        const spotlight = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument).spotlight;

        const material = new THREE.LineBasicMaterial({ color: spotlight.color });
        const points = [];
        points.push(new THREE.Vector3(selectedinstrument.position.x, -50, selectedinstrument.position.z));
        points.push(new THREE.Vector3(selectedinstrument.position.x, 50, selectedinstrument.position.z));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        verticalLine = new THREE.Line(geometry, material);
        scene.add(verticalLine);
    }
}

// Shift key modifier
document.addEventListener('keydown', function (event) {
    if (event.key == "Shift") {
        dragDirection = 'vertical';
        addVerticalLine();

    }
});

// Shift key modifier
document.addEventListener('keyup', function (event) {
    if (event.key == "Shift") {
        dragDirection = 'horizontal';
        removeVerticalLine();

    }
});

// Update a each panner's position
// TODO make sure the math is right on this (in terms of normalizing to the 3D scene)
function updatePanners() {
    const rect = canvas.getBoundingClientRect();

    instrumentClusters.forEach(cluster => {
        // Z and Y are flipped
        cluster.panner.positionX.value = cluster.instrument.position.x;
        cluster.panner.positionY.value = cluster.instrument.position.z;
        cluster.panner.positionZ.value = cluster.instrument.position.y;
    });

}

// Play button
function playAudio() {
    // Iterate through the instruments and play a track for each one that has a valid audio buffer
    instrumentClusters.forEach(cluster => {
        if (cluster.audioBuffer) {
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
            cluster.sourceNode = null;
        }
    });
}

// Prevent drag across the screen from loading file into the browser
document.addEventListener('dragover', function (ev) {
    ev.preventDefault();
});

// Load audio URL to given instrument
function fetchAudio(url) {
    fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
        .then(decodedAudio => {
            audioBuffer = decodedAudio;
        });
}

function getRandomAudioFilePath(index) {
    const audioFiles = [
        'src/audio/beat.mp3',
        'src/audio/bass.wav',
        'src/audio/melody.wav',
        'src/audio/pad.wav',
        'src/audio/beat.wav'
    ];
    return audioFiles[index];
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
                    console.log(ev)
                    var file = ev.dataTransfer.items[0].getAsFile();
                    loadAudioToInstrument(cluster,file);

                }
            }
        });
    }
});

function loadAudioToInstrument(instrument, file) {
    var reader = new FileReader();
    reader.onload = function(file) {
        console.log("Here is instrument in file load: " + instrument)
        audioCtx.decodeAudioData(file.target.result, function(buffer) {
            console.log("Here is cluster in buffer load: " + instrument)
            instrument.sourceNode = audioCtx.createBufferSource();
            instrument.audioBuffer = buffer;
            instrument.sourceNode.buffer = instrument.audioBuffer;

            var playbackSpeed = 1;
            instrument.sourceNode.playbackRate.value = playbackSpeed;

            instrument.sourceNode.connect(instrument.panner);
            instrument.panner.connect(audioCtx.destination);

        }) 

    };
    reader.readAsArrayBuffer(file);
}

// Transport controls
document.getElementById('play-button').addEventListener('click', () => {
    playAudio();
});

document.getElementById('stop-button').addEventListener('click', () => {
    stopAudio();
});

document.getElementById('download-button').addEventListener('click', () => {
});

document.getElementById('clear-button').addEventListener('click', () => {
    if (recordingState != 'saved') return;

    const userConfirmed = window.confirm("Are you sure you want to delete your recording?");
    if (userConfirmed) {
        // Delete the recording

        // Reset the recording button
        recordingState = 'idle';
        const recordButton = document.getElementById('record-button');
        recordButton.className = 'idle';
    }
});

const recordButton = document.getElementById('record-button');

// Toggle recording state when the button is clicked
recordButton.addEventListener('click', function () {
    switch (recordingState) {
        case 'idle':
            recordingState = 'recording';
            this.className = 'recording';
            break;
        case 'recording':
            recordingState = 'saved';
            this.className = 'saved';
            break;
        case 'saved':
            recordingState = 'recording';
            this.className = 'recording';
            break;
    }
});


