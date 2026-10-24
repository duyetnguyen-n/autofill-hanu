// Bound pending relay reads in this browser. No server cache or extra service.
export class ReadQueue {
  private running=0;
  private waiting:Array<()=>void>=[];
  async run<T>(work:()=>Promise<T>):Promise<T>{
    if(this.running>=2)await new Promise<void>(resolve=>this.waiting.push(resolve));
    else this.running++;
    try{return await work();}
    finally{const next=this.waiting.shift();if(next)next();else this.running--;}
  }
}
