using System;
using System.Text.Json;
using Newtonsoft.Json;

namespace TestProject
{
    class Program
    {
        static void Main(string[] args)
        {
            // Test case 1: Core type - int
            var foo = 5;
            Console.WriteLine(foo);

            // Test case 2: Direct type reference - JsonSerializer (System.Text.Json)
            var options = new JsonSerializerOptions();
            
            // Test case 3: 3rd party library - JsonConvert (Newtonsoft.Json)
            var json = JsonConvert.SerializeObject(new { Name = "Test" });
            Console.WriteLine(json);
        }
    }
}
