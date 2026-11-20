/** Pure UI guard for navigating the four Studio steps.
 * Navigating the stepper never submits an order, starts a job or charges Credits.
 * Forward travel is limited to validated and persisted input prerequisites.
 */
export type StudioStepNavigation={
 currentStep:number;targetStep:number;ready:boolean;busy:boolean;generating:boolean;
 generationStarted:boolean;audioValid:boolean;hasPhoto:boolean;frameValid:boolean;
 imageReady:boolean;photoPending:boolean;photoApplied:boolean;
};

export function canNavigateStudioStep(state:StudioStepNavigation):boolean{
 const {currentStep,targetStep,ready,busy,generating,generationStarted,
  audioValid,hasPhoto,frameValid,imageReady,photoPending,photoApplied}=state;
 if(!Number.isInteger(currentStep)||currentStep<0||currentStep>3||
    !Number.isInteger(targetStep)||targetStep<0||targetStep>3)return false;
 if(!ready||busy||generating||generationStarted)return false;
 if(targetStep<=currentStep)return true;
 if(!audioValid)return false;
 if(targetStep===1)return true;
 if(!hasPhoto||!frameValid)return false;
 // The Photo step must finish the existing framing/upload path before advancing.
 if(photoPending||!photoApplied)return currentStep===1&&imageReady;
 return true;
}
