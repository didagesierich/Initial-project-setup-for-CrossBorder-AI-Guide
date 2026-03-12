function analyzeProcedure() {
  const input = document.querySelector("textarea").value.trim();
  const output = document.getElementById("output");

  if (!input) {
    output.innerHTML = `
      <div style="padding:16px;">
        Please describe your situation first.
      </div>
    `;
    return;
  }

  output.innerHTML = `
    <div style="padding:16px; line-height:1.6;">
      <h3 style="margin-top:0;">Cross-Border Procedure Roadmap</h3>
      <p><strong>Scenario:</strong> ${input}</p>
      <p><strong>Required documents:</strong><br>
      - Birth certificate<br>
      - Marriage certificate or relevant civil-status document<br>
      - Certified translation<br>
      - Valid ID or passport</p>

      <p><strong>Responsible institutions:</strong><br>
      - Civil registry in target country<br>
      - Civil registry in origin country<br>
      - Authorized translation service</p>

      <p><strong>Complexity level:</strong> Medium</p>

      <p><strong>Next steps:</strong><br>
      1. Collect the original documents<br>
      2. Verify whether certified translations are required<br>
      3. Submit the documents to the relevant authority<br>
      4. Confirm whether recognition or registration is complete</p>
    </div>
  `;
}
