## 3DStage

![3D Stage](src/screenshot.png)

#### Installation
To run the vizualization, you will need to install node and npm. Follow installation instructions for your OS.
<br>
https://nodejs.org/en
<br>
https://www.npmjs.com/
<br>
Once installed, open the project to the directory where you see index.html and use npm to install three.js and vite
```
npm install --save three
npm install --save-dev vite
```

Run one last install to get the final dependency:

```
npx install
```
Run the project with this command:

```
npx vite
```

Then, it should give you a localhost URL to open. 

You can dynamically increase the number of drums with the GUI slider. 
Some (but probably not all) ToDos:

- Add Audio
- Add representation of listener center stage
- Replace drums with other instruments or abstract shapes
- Remove lighting controls
- Add vertical displacement ( also will affect lighting and audio)
- Transport controls 
 
#### Resources
three.js
https://threejs.org/examples
<br>

Web Audio API
https://mdn.github.io/webaudio-examples/
<br>
