import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as dat from 'dat.gui';

// Setup scene
const scene = new THREE.Scene();

// Create audio context
var audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Setup camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 0);

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
// let keyboardTemplate = ... TODO when we have more models, create a gltf template for each

// Load instrument model
loader.load('src/drum/scene.gltf', function (gltf) {
    drumTemplate = gltf.scene;
    drumTemplate.scale.set(0.01, 0.01, 0.01); // Scale down the instrument
    console.log("Loaded drum template from model");
    // Load one initial instrument
    updateInstruments(1);
});

// Create GUI
const gui = new dat.GUI();

// Recording state (one of 'cleared' | 'recording' | 'saved )
let recordingState = 'cleared';

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
    //stopAudio();

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

        // Assign complementary colors to spotlights unique for each instrument
        // TODO change the cloned template once you have more models
        switch (i % 4) {
            case 0:
                spotlight.color.set(0x00ffff); // Cyan spotlight
                instrument = drumTemplate.clone(); // Drum
                break;

            case 1:
                spotlight.color.set(0xff00ff); // Magenta spotlight
                instrument = drumTemplate.clone(); // Drum
                break;

            case 2:
                spotlight.color.set(0x0000ff); // Blue spotlight
                instrument = drumTemplate.clone(); // Drum
                break;

            case 3:
                spotlight.color.set(0xcc00cc); // Pink spotlight
                instrument = drumTemplate.clone(); // Drum
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
        // Create a panner node
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

    // Add controls for angle
    const angleControl = folder.add(spotlight, 'angle', 0, Math.PI / 2).name('Angle').onChange(value => {
        spotlight.angle = value;
    });

    // Add controls for penumbra
    const penumbraControl = folder.add(spotlight, 'penumbra', 0, 1).name('Penumbra').onChange(value => {
        spotlight.penumbra = value;
    });

    // Add controls for intensity
    const intensityControl = folder.add(spotlight, 'intensity', 0, 50).name('Intensity');

    // Add controls for position
    const positionControl = folder.add(spotlight.position, 'y', 0, 10).name('Height');

    // Add controls for target position
    const targetPositionControl = folder.add(spotlight.target.position, 'y', 0, 5).name('Target Height');

    folder.open(); // Open the folder by default
}



// Add stage
const stageGeometry = new THREE.CircleGeometry(10, 32);
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
                selectedinstrument.position.y = intersectionPoint.y;
            }


            // Update spotlight target position (TODO only if what we are moving is an instrument and not the listener object)
            const spotlight = instrumentClusters.find(cluster => cluster.instrument === selectedinstrument).spotlight;
            spotlight.target.position.copy(intersectionPoint);
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
        selectedinstrument = null; // Deselect the instrument
        controls.enabled = true; // Re-enable OrbitControls
    }
});

// Shift key modifier
document.addEventListener('keydown', function (event) {
    if (event.shiftKey) {
        dragDirection = 'vertical';
    }
});

// Shift key modifier
document.addEventListener('keyup', function (event) {
    if (event.shiftKey) {
        dragDirection = 'horizontal';
    }
});

// Update a each panner's position
// TODO make sure the math is right on this (in terms of normalizing to the 3D scene)
function updatePanners() {
    const rect = canvas.getBoundingClientRect();
    // const normX = ((x - rect.left) / canvas.width) * 2 - 1;
    // const normY = -(((y - rect.top) / canvas.height) * 2 - 1);
    // const normZ = z;

    // console.log(JSON.stringify("X: " + panner.positionX.value, null, 4));
    // console.log(JSON.stringify("Y: " +panner.positionY.value, null, 4));
    // console.log(JSON.stringify("Z: " +panner.positionZ.value, null, 4));

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
            if (cluster.sourceNode) cluster.sourceNode.disconnect();
            cluster.sourceNode = audioCtx.createBufferSource();
            cluster.sourceNode.buffer = cluster.audioBuffer;

            var playbackSpeed = 1;
            cluster.sourceNode.playbackRate.value = playbackSpeed;

            cluster.sourceNode.connect(cluster.panner);
            cluster.panner.connect(audioCtx.destination);

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
                const url = 'src/audio/beat.mp3';

                // For now, we are just testing with a static file
                fetch(url)
                    .then(response => response.arrayBuffer())
                    .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
                    .then(decodedAudio => {
                        cluster.audioBuffer = decodedAudio;
                    })

                // TODO: do this instead to actually load the file (probably needs to be tweaked a bit)
                // if (ev.dataTransfer.items) {
                //     var file = ev.dataTransfer.items[0].getAsFile();
                //     var reader = new FileReader();
                //     reader.onload = function(e) {
                //     };
                //     reader.readAsArrayBuffer(file);
                // }
            }
        });

    }


});

// Transport controls
document.getElementById('play-button').addEventListener('click', () => {
    // Play functionality
    playAudio();
});

document.getElementById('stop-button').addEventListener('click', () => {
    // Stop functionality
    stopAudio();
});

document.getElementById('download-button').addEventListener('click', () => {
    // Download functionality
});

document.getElementById('clear-button').addEventListener('click', () => {
    // Clear functionality
    recordingState = 'cleared';
    updateRecordingButtonState();
});

const recordButton = document.getElementById('record-button');

// Toggle recording state when the button is clicked
recordButton.addEventListener('click', function () {
    switch (recordingState) {
        case 'cleared':
            recordingState = 'recording';
            // begin recording
            break;
        case 'recording':
            recordingState = 'saved';
            // stop and save recording
            break;
        case 'saved':
            recordingState = 'recording';
            // begin recording
            break;
    }
    updateRecordingButtonState();
});

// Function to update the button appearance based on the recording state
function updateRecordingButtonState() {
    recordButton.classList.remove('record-active', 'recording-saved');
    switch (recordingState) {
        case 'cleared':
            recordButton.style.border = '2px solid #333'; /* White circle border color */
            recordButton.style.backgroundColor = '#fff'; /* White circle background color */
            recordButton.style.cursor = 'pointer'; /* Change cursor to pointer */
            break;
        case 'recording':
            recordButton.classList.add('record-active');
            break;
        case 'saved':
            recordButton.classList.add('recording-saved');
            break;
    }
}

