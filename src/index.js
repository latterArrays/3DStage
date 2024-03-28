import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Load dat.GUI library
import * as dat from 'dat.gui';

// Create GUI
const gui = new dat.GUI();

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

// Load drum model
const loader = new GLTFLoader();
let selectedDrum = null; // Variable to store the selected drum
let offset = new THREE.Vector3(); // Variable to store offset between clicked position and drum position

// Add fog to the scene
//scene.fog = new THREE.Fog(0x111111, 1, 20); // Color, near, far


const spotlights = []; // Define spotlights array

// Load drum model
loader.load('src/drum/scene.gltf', function (gltf) {
    const drumTemplate = gltf.scene;
    drumTemplate.scale.set(0.01, 0.01, 0.01); // Scale down the drum
    // Position drums around the stage
    const radius = 5;
    const angleIncrement = Math.PI / 2;
    const numDrums = 4;

    for (let i = 0; i < numDrums; i++) {
        const angle = i * angleIncrement;
        const x = radius * Math.cos(angle);
        const z = radius * Math.sin(angle);
        
        const drum = drumTemplate.clone(); // Clone the drum model
        drum.position.set(x, .4, z); // Set position for this drum instance
        scene.add(drum); // Add drum instance to the scene

        // Add userData to mark drum as draggable
        drum.userData.draggable = true;

        // Add spotlight above each drum
        const spotlight = new THREE.SpotLight(0xffffff, 2); // Cone spotlight with increased intensity
        spotlight.position.set(x * 1.5, 5, z * 1.5); // Position outside the stage
        spotlight.target.position.set(x, 0, z); // Direct light towards the drum
        scene.add(spotlight.target); // Add spotlight target to the scene
        scene.add(spotlight); // Add spotlight to the scene
        
        // Create controls for this spotlight
        createSpotlightControls(spotlight, i);

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
        
        spotlights.push(spotlight); // Push spotlight to spotlights array
    }
});


// Function to create controls for each spotlight
function createSpotlightControls(spotlight, index) {
    const folder = gui.addFolder(`Spotlight ${index + 1}`);
    
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

    // Add controls for intensity
    const intensityControl = folder.add(spotlight, 'intensity', 0, 5).name('Intensity');

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
scene.add(stage);


// Update function
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    // Adjust spotlight intensity based on camera position
    // for (const light of spotlights) {
    //     light.intensity = 0.2 + Math.abs(camera.position.y - light.position.y) * 0.5; // Adjust intensity based on distance from camera
    // }
    renderer.render(scene, camera);
}

animate();

// Event listeners for mouse movement and release
let isDragging = false;
let previousMousePosition = {
    x: 0,
    y: 0
};

document.addEventListener('mousedown', function(event) {
    event.preventDefault();
    const mouse = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: - (event.clientY / window.innerHeight) * 2 + 1
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const draggableObjects = scene.children.filter(child => child.userData.draggable);
    const intersects = raycaster.intersectObjects(draggableObjects);
    if (intersects.length > 0) {
        isDragging = true;
        selectedDrum = intersects[0].object;
        controls.enabled = false; // Disable OrbitControls while dragging
        const intersectionPoint = intersects[0].point;
        offset.copy(intersectionPoint).sub(selectedDrum.position);
    }
});

// Define variables to track hotkey states
let ctrlPressed = false;

// Event listener for keydown to track Ctrl key press
document.addEventListener('keydown', function(event) {
    if (event.key === 'Control') {
        ctrlPressed = true;
    }
});

// Event listener for keyup to track Ctrl key release
document.addEventListener('keyup', function(event) {
    if (event.key === 'Control') {
        ctrlPressed = false;
    }
});

document.addEventListener('mousemove', function(event) {
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
            // Calculate the new position of the drum
            const newPosition = new THREE.Vector3().copy(intersectionPoint).sub(offset);
            selectedDrum.position.copy(newPosition);
            console.log("New position:" + JSON.stringify(newPosition,null,4))
            console.log("Drum position:" + JSON.stringify(selectedDrum.position,null,4))
        }
    }
});


document.addEventListener('mouseup', function(event) {
    event.preventDefault();
    if (isDragging) {
        isDragging = false;
        selectedDrum = null; // Deselect the drum
        controls.enabled = true; // Re-enable OrbitControls
    }
});
