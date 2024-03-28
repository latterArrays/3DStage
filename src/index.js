import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as dat from 'dat.gui';

// Setup scene
const scene = new THREE.Scene();

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

// Load drum model
const loader = new GLTFLoader();
let selectedDrum = null; // Variable to store the selected drum
let drumTemplate = null;
// Create GUI
const gui = new dat.GUI();

// Define DrumSpotlight class
class DrumSpotlight {
    constructor(drum, spotlight) {
        this.drum = drum;
        this.spotlight = spotlight;
    }
}

// Array to hold clusters of drums and spotlights
const drumSpotlightClusters = [];



// GUI parameters object
const guiParams = {
    numDrums: 1 // Initial number of drums
};

// Add controls for the number of drums
const numDrumsControl = gui.add(guiParams, 'numDrums', 1, 5, 1).name('Number of Drums').onChange(value => {
    updateDrums(value);
});

dat.GUI.prototype.removeFolder = function(name) {
    var folder = this.__folders[name];
    if (!folder) {
      return;
    }
    folder.close();
    this.__ul.removeChild(folder.domElement.parentNode);
    delete this.__folders[name];
    this.onResize();
  }
  
// Function to update the number of drums
function updateDrums(numDrums) {
    // Remove existing drums and spotlights
    drumSpotlightClusters.forEach(cluster => {
        scene.remove(cluster.drum);
        scene.remove(cluster.spotlight.target);
        scene.remove(cluster.spotlight);

        // Remove the folder associated with this spotlight
        const folderName = `Spotlight ${cluster.index + 1}`;
        if (gui.__folders[folderName]) {
            gui.removeFolder(folderName);
        }
    });
    drumSpotlightClusters.length = 0;

    // Add new drums and spotlights
    const angleIncrement = (2 * Math.PI) / numDrums;
    const radius = 5;

    for (let i = 0; i < numDrums; i++) {
        const angle = i * angleIncrement;
        const x = radius * Math.cos(angle);
        const z = radius * Math.sin(angle);

        const drum = drumTemplate.clone(); // Clone the drum model
        drum.position.set(x, 0.4, z); // Set position for this drum instance
        scene.add(drum); // Add drum instance to the scene

        // Add userData to mark drum as draggable
        drum.userData.draggable = true;

        // Add spotlight above each drum
        const spotlight = new THREE.SpotLight(0xffffff, 2); // Cone spotlight with increased intensity
        spotlight.position.set(x * 2.5, 4, z * 2.5); // Position outside the stage
        spotlight.target.position.set(x, 0, z); // Direct light towards the drum
        scene.add(spotlight.target); // Add spotlight target to the scene
        scene.add(spotlight); // Add spotlight to the scene



        // Assign complementary colors to spotlights
        switch (i % 4) {
            case 0:
                spotlight.color.set(0x00ffff); // Cyan spotlight
                break;
            case 1:
                spotlight.color.set(0xff00ff); // Magenta spotlight
                break;
            case 2:
                spotlight.color.set(0x0000ff); // Blue spotlight
                break;
            case 3:
                spotlight.color.set(0xcc00cc); // Pink spotlight
                break;
        }

        spotlight.intensity = 35;
        spotlight.angle = 0.4;
        spotlight.penumbra = 0.2;
        

        // Create controls for this spotlight
        createOrUpdateSpotlightControls(spotlight, i);

        const drumSpotlight = new DrumSpotlight(drum, spotlight); // Create DrumSpotlight instance
        drumSpotlight.index = i;
        drumSpotlightClusters.push(drumSpotlight); // Push to clusters array
    }
}


// Load drum model
loader.load('src/drum/scene.gltf', function (gltf) {
    drumTemplate = gltf.scene;
    drumTemplate.scale.set(0.01, 0.01, 0.01); // Scale down the drum
    updateDrums(1);
});

// Creates or updates spotlight controls and adds them to the UI
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

document.addEventListener('mousedown', function (event) {
    event.preventDefault();
    const mouse = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: - (event.clientY / window.innerHeight) * 2 + 1
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const draggableObjects = drumSpotlightClusters.map(cluster => cluster.drum);
    const intersects = raycaster.intersectObjects(draggableObjects);
    if (intersects.length > 0) {
        isDragging = true;
        selectedDrum = intersects[0].object;
        while (selectedDrum.parent.parent !== null) {
            selectedDrum = selectedDrum.parent;
        }
        controls.enabled = false; // Disable OrbitControls while dragging
    }
});

document.addEventListener('mousemove', function (event) {
    event.preventDefault();
    if (isDragging && selectedDrum) {
        const mouse = {
            x: (event.clientX / window.innerWidth) * 2 - 1,
            y: - (event.clientY / window.innerHeight) * 2 + 1
        };
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObject(stage);
        if (intersects.length > 0) {
            const intersectionPoint = intersects[0].point;
            selectedDrum.position.x = intersectionPoint.x;
            selectedDrum.position.z = intersectionPoint.z;

            // Update spotlight target position
            const spotlight = drumSpotlightClusters.find(cluster => cluster.drum === selectedDrum).spotlight;
            spotlight.target.position.copy(intersectionPoint);
        }
    }
});


document.addEventListener('mouseup', function (event) {
    event.preventDefault();
    if (isDragging) {
        isDragging = false;
        selectedDrum = null; // Deselect the drum
        controls.enabled = true; // Re-enable OrbitControls
    }
});
