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



// Trying to figure out record and download - media stream required for this
const dest = audioCtx.createMediaStreamDestination();

//recorder...
const options = { mimeType: 'audio/webm' }; //force proper audio wav format; audio/wav does not work on macOS
const recorder = new MediaRecorder(dest.stream, options);

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

    //note the adjusted constructor to accomodate filters.
    constructor(instrument, spotlight, lowShelfFilter, highShelfFilter, panner) {
        this.instrument = instrument;
        this.spotlight = spotlight;
        
        //audio
        this.audioBuffer = null;
        this.sourceNode = null;

        //set filter types and initial corner freqs?
        this.lowShelfFilter = lowShelfFilter;
        // this.lowShelfFilter.type = "lowshelf";
        // this.lowShelfFilter.frequency.setValueAtTime(320, audioCtx.currentTime);
        this.highShelfFilter = highShelfFilter;
        // this.highShelfFilter.type = "highshelf"
        // this.highShelfFilter.frequency.setValueAtTime(3200, audioCtx.currentTime);

        //binaural
        this.panner = panner;


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
const numInstrumentsControl = gui.add(guiParams, 'numInstruments', 1, 4, 1).name('Instruments').onChange(value => {
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
        
        //set init pos to center
        panner.orientationX.setValueAtTime(0, audioCtx.currentTime); // TODO assuming this needs to face the listener from where the cluster is, we'll need to modify this
        panner.orientationY.setValueAtTime(0, audioCtx.currentTime);
        panner.orientationZ.setValueAtTime(0, audioCtx.currentTime);

        //console.log('At time of insertion, instrument is ' + JSON.stringify(instrument))
        const instrumentCluster = new InstrumentCluster(instrument, spotlight, lowShelfFilter, highShelfFilter, panner); // Create instrumentCluster instance
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

        //rename to updateParameters
        updateParameters();
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

// Update a each panner's position - renamed to updateParameters()
// TODO make sure the math is right on this (in terms of normalizing to the 3D scene)
function updateParameters() {
    const rect = canvas.getBoundingClientRect();

    instrumentClusters.forEach(cluster => {
        // Z and Y are flipped

        let transitionTime = 0.1;
        let currentTime = audioCtx.currentTime;


        // for scaling function
        const inputStart = -1, inputEnd = 1;

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
        const playbackSpeed = scaleValue(cluster.instrument.position.y, 0, inputEnd, 0, 2);

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

// Can we delete this?
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

            instrument.sourceNode.loop = true;

            //we need to figure out the best way to listen and scale each object's vertical value for playback speed
            var playbackSpeed = 1;//document.getElementById('').value;
            instrument.sourceNode.playbackRate.value = playbackSpeed;

            instrument.sourceNode.connect(instrument.lowShelfFilter);
            instrument.lowShelfFilter.connect(instrument.highShelfFilter);
            instrument.highShelfFilter.connect(instrument.panner);
            instrument.panner.connect(dest);
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

//Recorder stuff: starting with a buffer to record audio into. should always be global.
let audioChunks = [];

recorder.ondataavailable = e => {
    audioChunks.push(e.data);
};

recorder.onstop = e => {

    console.log("Recording stopped. Ready to download.");

    // const blob = new Blob(audioChunks, { type: 'audio/wav' });
    // const url = URL.createObjectURL(blob);
    // // Create a link to download the audio
    // const a = document.createElement('a');
    // a.style.display = 'none';
    // a.href = url;
    // a.download = 'recording.wav';
    // document.body.appendChild(a);
    // a.click();
    // window.URL.revokeObjectURL(url);
};


const recordButton = document.getElementById('record-button');

// Toggle recording state when the button is clicked
recordButton.addEventListener('click', function () {
    switch (recordingState) {
        case 'idle':
            recordingState = 'recording';
            this.className = 'recording';

            audioChunks = []; // Reset the chunks array
          
            recorder.start();
            console.log("start recording");

            break;
        case 'recording':
            
            recordingState = 'saved';
            this.className = 'saved';

            recorder.stop();

            console.log("stop, download");
            break;
        case 'saved':

            recordingState = 'recording';
            this.className = 'recording';
            break;
    }
});

// new generic modal approach to both download and delete transport controls
document.addEventListener('DOMContentLoaded', function () {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalDialog = document.getElementById('modal-dialog');
    const confirmBtn = document.getElementById('modal-confirm');
    const messageParagraph = document.getElementById('modal-message');

    window.showModal = function (message, onConfirm) { // Attach showModal to window for global access
        messageParagraph.textContent = message;  // Set the text for the modal message

        confirmBtn.onclick = function () {
            if (typeof onConfirm === "function") {
                onConfirm();  // Execute the confirm callback if it's a function
            }
            closeModal();  // Close the modal after confirmation
        };

        modalBackdrop.style.display = 'block';
        modalDialog.style.display = 'block';
    };

    window.closeModal = function () {  // Also ensure closeModal is globally accessible
        modalBackdrop.style.display = 'none';
        modalDialog.style.display = 'none';
    };

    const downloadButton = document.getElementById('download-button');
 
    if (downloadButton) {
        downloadButton.addEventListener('click', function () {
            if (!audioChunks.length) {
                alert("No recording available to download.");
                return;
            }
            window.showModal("Your audio recording is ready for download. Please confirm.", function () {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'recording.wav'; //wav but needs ffmpeg to play in audacity for cross platform
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            });
        });
    }
});


//button handlers like for 'clear' can also invoke showModal as needed
document.getElementById('clear-button').addEventListener('click', function() {
    if (recordingState !== 'saved' && !audioChunks.length) {
        console.log("No recording to delete.");
        return;
    }
    showModal("Are you sure you want to delete your recording?", function() {
        audioChunks = []; // Clear the recorded data
        recordingState = 'idle';
        const recordButton = document.getElementById('record-button');
        recordButton.className = 'idle';
        console.log("Recording deleted.");
    });
});


